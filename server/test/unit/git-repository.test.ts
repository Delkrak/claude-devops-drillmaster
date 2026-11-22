import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRepository } from '../../src/adapters/gitRepository.js'
import { tempDir } from '../helpers.js'

let root: Awaited<ReturnType<typeof tempDir>>
let remote: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const ownedBy = (writer: string) => (filePath: string) => filePath.endsWith(`/${writer}.jsonl`)

beforeAll(async () => {
  root = await tempDir('git-store')
  remote = path.join(root.dir, 'store.git')
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', remote])
})
afterAll(() => root.remove())

describe('the Drillmaster repository, through git plumbing', () => {
  it('writes item branches side by side, without a checkout, and pushes them', async () => {
    const store = new GitRepository(path.join(root.dir, 'clone-a'), remote)
    await store.ensureClone()
    expect(await store.writeFiles('main', { 'p/project/a.jsonl': '{"id":"e1"}\n' }, 'setup')).toBe(true)
    await store.push('main', ownedBy('a'))
    await store.writeFiles('drillmaster/wi_1', { 'p/items/wi_1/a.jsonl': '{"id":"e2"}\n' }, 'wi_1 stage 1')
    await store.writeFiles('drillmaster/wi_2', { 'p/items/wi_2/a.jsonl': '{"id":"e3"}\n' }, 'wi_2 stage 1')
    expect(await store.writeFiles('drillmaster/wi_2', { 'p/items/wi_2/a.jsonl': '{"id":"e3"}\n' }, 'no change')).toBe(false)
    await store.push('drillmaster/wi_1', ownedBy('a'))
    await store.push('drillmaster/wi_2', ownedBy('a'))
    expect(git(remote, 'for-each-ref', '--format=%(refname:short)').split('\n').sort()).toEqual(['drillmaster/wi_1', 'drillmaster/wi_2', 'main'])
    expect(git(remote, 'show', 'drillmaster/wi_1:p/items/wi_1/a.jsonl')).toBe('{"id":"e2"}')
    expect(git(remote, 'show', 'drillmaster/wi_1:p/project/a.jsonl')).toBe('{"id":"e1"}')
  })

  it('squash-merges a finished item into main as one commit, and deletes its branch', async () => {
    const store = new GitRepository(path.join(root.dir, 'clone-a'), remote)
    await store.writeFiles('drillmaster/wi_1', { 'p/items/wi_1/a.jsonl': '{"id":"e2"}\n{"id":"e4"}\n' }, 'wi_1 stage 2')
    const mainBefore = git(remote, 'rev-parse', 'main')
    await store.squashMerge('drillmaster/wi_1', 'p/items/wi_1', 'wi_1 (#1) delivered')
    await store.push('main', ownedBy('a'))
    await store.deleteBranch('drillmaster/wi_1')
    expect(git(remote, 'rev-list', '--count', `${mainBefore}..main`)).toBe('1')
    expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('wi_1 (#1) delivered')
    expect(git(remote, 'show', 'main:p/items/wi_1/a.jsonl')).toBe('{"id":"e2"}\n{"id":"e4"}')
    expect(git(remote, 'for-each-ref', '--format=%(refname:short)')).not.toContain('drillmaster/wi_1')
  })

  it('lays its own files on top when another machine pushed first, and reads every branch', async () => {
    const first = new GitRepository(path.join(root.dir, 'clone-a'), remote)
    const second = new GitRepository(path.join(root.dir, 'clone-b'), remote)
    await second.ensureClone()
    await second.writeFiles('main', { 'p/project/b.jsonl': '{"id":"b1"}\n' }, 'b writes')
    await second.push('main', ownedBy('b'))
    await first.writeFiles('main', { 'p/project/a.jsonl': '{"id":"e1"}\n{"id":"e5"}\n' }, 'a writes')
    await first.push('main', ownedBy('a'))
    expect(git(remote, 'show', 'main:p/project/b.jsonl')).toBe('{"id":"b1"}')
    expect(git(remote, 'show', 'main:p/project/a.jsonl')).toBe('{"id":"e1"}\n{"id":"e5"}')
    await second.fetch()
    const texts = await second.readJsonlFiles('p')
    expect(texts.join('')).toContain('"e5"')
    expect(texts.join('')).toContain('"e3"')
  })
})
