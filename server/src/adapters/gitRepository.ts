import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const GIT_TIMEOUT_MS = 60_000
const PUSH_ATTEMPTS = 3
const MAIN = 'main'
const MISSING_REF = '0'.repeat(40)

export class GitError extends Error {}

interface GitRun {
  args: string[]
  input?: string | Buffer
  env?: NodeJS.ProcessEnv
  allowFailure?: boolean
}

/**
 * A Drillmaster repository, written through its own bare clone with git plumbing: any number of
 * branches are written side by side, and nothing is ever checked out.
 */
export class GitRepository {
  constructor(
    private readonly cloneDir: string,
    private readonly remote: string,
  ) {}

  private git({ args, input, env, allowFailure }: GitRun): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        args,
        {
          cwd: existsSync(this.cloneDir) ? this.cloneDir : undefined,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Drillmaster', GIT_AUTHOR_EMAIL: 'drillmaster@localhost', GIT_COMMITTER_NAME: 'Drillmaster', GIT_COMMITTER_EMAIL: 'drillmaster@localhost', ...env },
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error && !allowFailure) reject(new GitError(`git ${args.join(' ')}: ${(stderr || error.message).trim()}`))
          else resolve({ ok: !error, stdout: stdout.toString(), stderr: stderr.toString() })
        },
      )
      if (input !== undefined) child.stdin?.end(input)
    })
  }

  /** Clones beside the clone's place and moves it there, so processes that clone at once don't break each other. */
  async ensureClone() {
    if (existsSync(path.join(this.cloneDir, 'HEAD'))) return
    await mkdir(path.dirname(this.cloneDir), { recursive: true })
    const aside = `${this.cloneDir}.${process.pid}-${Math.random().toString(36).slice(2)}`
    try {
      await this.git({ args: ['clone', '--bare', '--quiet', this.remote, aside] })
      await rename(aside, this.cloneDir).catch((error: unknown) => {
        if (!existsSync(path.join(this.cloneDir, 'HEAD'))) throw error
      })
    } finally {
      await rm(aside, { recursive: true, force: true })
    }
  }

  async tip(ref: string): Promise<string | null> {
    const { ok, stdout } = await this.git({ args: ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], allowFailure: true })
    return ok ? stdout.trim() : null
  }

  private async treeOf(commit: string) {
    return (await this.git({ args: ['rev-parse', `${commit}^{tree}`] })).stdout.trim()
  }

  private async buildTree(base: string | null, entries: { path: string; blob: string }[]) {
    const indexFile = path.join(os.tmpdir(), `drillmaster-index-${process.pid}-${Math.random().toString(36).slice(2)}`)
    const env = { GIT_INDEX_FILE: indexFile }
    try {
      await this.git({ args: base ? ['read-tree', base] : ['read-tree', '--empty'], env })
      for (const entry of entries) await this.git({ args: ['update-index', '--add', '--cacheinfo', `100644,${entry.blob},${entry.path}`], env })
      return (await this.git({ args: ['write-tree'], env })).stdout.trim()
    } finally {
      await rm(indexFile, { force: true })
    }
  }

  /** Commits the tree on the branch, only if the branch is still where it was (or still missing). */
  private async commit(branch: string, tree: string, parent: string | null, message: string) {
    const commit = (await this.git({ args: ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message] })).stdout.trim()
    const branchTip = await this.tip(`refs/heads/${branch}`)
    await this.git({ args: ['update-ref', `refs/heads/${branch}`, commit, branchTip ?? MISSING_REF] })
    return commit
  }

  private async blobOf(content: string | Buffer) {
    return (await this.git({ args: ['hash-object', '-w', '--stdin'], input: content })).stdout.trim()
  }

  /** Writes files on a branch (new branches start from main). Returns false when nothing changed. */
  async writeFiles(branch: string, files: Record<string, string | Buffer>, message: string): Promise<boolean> {
    const parent = (await this.tip(`refs/heads/${branch}`)) ?? (await this.tip(`refs/heads/${MAIN}`))
    const entries = await Promise.all(Object.entries(files).map(async ([filePath, content]) => ({ path: filePath, blob: await this.blobOf(content) })))
    const tree = await this.buildTree(parent, entries)
    const branchExists = (await this.tip(`refs/heads/${branch}`)) !== null
    if (parent && branchExists && tree === (await this.treeOf(parent))) return false
    await this.commit(branch, tree, parent, message)
    return true
  }

  private async filesUnder(ref: string, folder?: string) {
    const { stdout } = await this.git({ args: ['ls-tree', '-r', ref, ...(folder ? ['--', folder] : [])] })
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, filePath] = line.split('\t') as [string, string]
        return { path: filePath, blob: meta.split(' ')[2]! }
      })
  }

  /** One commit on main that adds the branch's `folder`, as it is on the branch. */
  async squashMerge(branch: string, folder: string, message: string) {
    const branchTip = await this.tip(`refs/heads/${branch}`)
    if (!branchTip) throw new GitError(`There is no branch ${branch} to merge.`)
    const mainTip = await this.tip(`refs/heads/${MAIN}`)
    const tree = await this.buildTree(mainTip, await this.filesUnder(branchTip, folder))
    if (mainTip && tree === (await this.treeOf(mainTip))) return
    await this.commit(MAIN, tree, mainTip, message)
  }

  /**
   * Pushes a branch. When the remote moved on (another machine pushed), the files this writer owns
   * are laid on top of the remote's branch and pushed again: writers never share a file, so this
   * never conflicts.
   */
  async push(branch: string, ownsFile: (filePath: string) => boolean) {
    for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
      const pushed = await this.git({ args: ['push', '--quiet', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], allowFailure: true })
      if (pushed.ok) return
      const fetched = await this.git({ args: ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], allowFailure: true })
      const remoteTip = fetched.ok ? await this.tip(`refs/remotes/origin/${branch}`) : null
      const localTip = await this.tip(`refs/heads/${branch}`)
      if (!remoteTip || !localTip) throw new GitError(`Could not push ${branch}: ${pushed.stderr.trim()}`)
      const ours = (await this.filesUnder(localTip)).filter((file) => ownsFile(file.path))
      const tree = await this.buildTree(remoteTip, ours)
      const commit = (await this.git({ args: ['commit-tree', tree, '-p', remoteTip, '-m', `Drillmaster: ${branch} on top of the remote`] })).stdout.trim()
      await this.git({ args: ['update-ref', `refs/heads/${branch}`, commit] })
    }
    throw new GitError(`Could not push ${branch} after ${PUSH_ATTEMPTS} attempts.`)
  }

  async deleteBranch(branch: string) {
    await this.git({ args: ['update-ref', '-d', `refs/heads/${branch}`], allowFailure: true })
    await this.git({ args: ['push', '--quiet', 'origin', '--delete', branch], allowFailure: true })
  }

  async fetch() {
    await this.git({ args: ['fetch', '--quiet', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*'] })
  }

  /** The text of every `.jsonl` file under `folder`, on every local and fetched branch. */
  async readJsonlFiles(folder: string): Promise<string[]> {
    const { stdout } = await this.git({ args: ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'] })
    const texts: string[] = []
    const seenBlobs = new Set<string>()
    for (const ref of stdout.split('\n').filter(Boolean)) {
      for (const file of await this.filesUnder(ref, folder).catch(() => [])) {
        if (!file.path.endsWith('.jsonl') || seenBlobs.has(file.blob)) continue
        seenBlobs.add(file.blob)
        texts.push((await this.git({ args: ['cat-file', 'blob', file.blob] })).stdout)
      }
    }
    return texts
  }

  /** A file's text on a ref, or undefined when the ref or the file doesn't exist. */
  async readFile(ref: string, filePath: string): Promise<string | undefined> {
    const { ok, stdout } = await this.git({ args: ['cat-file', 'blob', `${ref}:${filePath}`], allowFailure: true })
    return ok ? stdout : undefined
  }

  /** Moves the local branch up to the fetched remote one, when the local one has nothing of its own. */
  async adoptRemote(branch: string) {
    const remoteTip = await this.tip(`refs/remotes/origin/${branch}`)
    if (!remoteTip) return
    const localTip = await this.tip(`refs/heads/${branch}`)
    if (localTip) {
      const behind = await this.git({ args: ['merge-base', '--is-ancestor', localTip, remoteTip], allowFailure: true })
      if (!behind.ok) return
    }
    await this.git({ args: ['update-ref', `refs/heads/${branch}`, remoteTip] })
  }

  async hasPath(ref: string, filePath: string) {
    if (!(await this.tip(`refs/heads/${ref}`))) return false
    const { stdout } = await this.git({ args: ['ls-tree', `refs/heads/${ref}`, '--', filePath] })
    return stdout.trim() !== ''
  }

  async branches(): Promise<string[]> {
    const { stdout } = await this.git({ args: ['for-each-ref', '--format=%(refname:short)', 'refs/heads'] })
    return stdout.split('\n').filter(Boolean)
  }
}
