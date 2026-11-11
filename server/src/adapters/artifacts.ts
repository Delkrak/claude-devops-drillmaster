import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Artifact } from '../core/events.js'
import type { ArtifactStore } from '../ports.js'

export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}
const TEXT_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.diff': 'text/x-diff',
  '.patch': 'text/x-diff',
}
/** Source and test files, kept and served as plain text. */
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.c', '.h', '.cpp', '.swift', '.sh', '.ps1', '.sql', '.css', '.scss', '.yaml', '.yml', '.toml', '.xml']
const MEDIA_TYPES: Record<string, string> = { ...IMAGE_TYPES, ...TEXT_TYPES, ...Object.fromEntries(SOURCE_EXTENSIONS.map((extension) => [extension, 'text/plain'])) }

export const ACCEPTED_ARTIFACTS = `images (${Object.keys(IMAGE_TYPES).join(' ')}), text (${Object.keys(TEXT_TYPES).join(' ')}) and source or test files (${SOURCE_EXTENSIONS.join(' ')})`

export class InvalidArtifact extends Error {}

const isGitIgnored = (projectDir: string, file: string) =>
  new Promise<boolean>((resolve) => {
    execFile('git', ['check-ignore', '-q', file], { cwd: projectDir, windowsHide: true }, (error) => resolve(error === null))
  })

export async function readArtifactFromWorkFolder(projectDir: string, requestedPath: string) {
  const workFolder = await realpath(projectDir)
  const file = await realpath(path.resolve(workFolder, requestedPath)).catch(() => {
    throw new InvalidArtifact(`Artifact ${requestedPath} does not exist.`)
  })
  const relative = path.relative(workFolder, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new InvalidArtifact(`Artifact ${requestedPath} is outside the work folder.`)
  const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()]
  if (!mediaType) throw new InvalidArtifact(`Artifact ${requestedPath} is none of the files Drillmaster keeps: ${ACCEPTED_ARTIFACTS}. Deliver without it, or as one of those.`)
  const { size } = await stat(file)
  if (size > MAX_ARTIFACT_BYTES) throw new InvalidArtifact(`Artifact ${requestedPath} is ${size} bytes; the limit is ${MAX_ARTIFACT_BYTES}.`)
  if (await isGitIgnored(workFolder, relative)) throw new InvalidArtifact(`Artifact ${requestedPath} is ignored by git, so it may hold secrets.`)
  return { relativePath: relative.split(path.sep).join('/'), mediaType, bytes: await readFile(file) }
}

const artifactName = (relativePath: string) => relativePath.replace(/[^a-zA-Z0-9._-]/g, '_')

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly projectsRoot: string) {}

  private file(projectId: string, workItemId: string, name: string) {
    return path.join(this.projectsRoot, projectId, 'artifacts', workItemId, name)
  }

  async save(projectId: string, workItemId: string, artifact: { relativePath: string; mediaType: string; bytes: Buffer }): Promise<Artifact> {
    const name = artifactName(artifact.relativePath)
    const file = this.file(projectId, workItemId, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, artifact.bytes)
    return { name, path: artifact.relativePath, media_type: artifact.mediaType, bytes: artifact.bytes.length }
  }

  async read(projectId: string, workItemId: string, name: string) {
    if (name !== artifactName(name)) return undefined
    return readFile(this.file(projectId, workItemId, name)).catch(() => undefined)
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly bytesByKey = new Map<string, Buffer>()

  async save(projectId: string, workItemId: string, artifact: { relativePath: string; mediaType: string; bytes: Buffer }): Promise<Artifact> {
    const name = artifactName(artifact.relativePath)
    this.bytesByKey.set(`${projectId}/${workItemId}/${name}`, artifact.bytes)
    return { name, path: artifact.relativePath, media_type: artifact.mediaType, bytes: artifact.bytes.length }
  }

  async read(projectId: string, workItemId: string, name: string) {
    return this.bytesByKey.get(`${projectId}/${workItemId}/${name}`)
  }
}
