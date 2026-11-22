import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileArtifactStore, InvalidArtifact, MAX_ARTIFACT_BYTES, readArtifactFromWorkFolder } from '../../src/adapters/artifacts.js'
import { tempDir } from '../helpers.js'

let work: Awaited<ReturnType<typeof tempDir>>
let outside: Awaited<ReturnType<typeof tempDir>>

beforeAll(async () => {
  work = await tempDir('artifacts-work')
  outside = await tempDir('artifacts-outside')
  execFileSync('git', ['init', '-q'], { cwd: work.dir })
  await writeFile(path.join(work.dir, '.gitignore'), '.env\nsecret.txt\n')
  await mkdir(path.join(work.dir, 'shots'))
  await writeFile(path.join(work.dir, 'shots', 'after.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(path.join(work.dir, 'secret.txt'), 'hunter2')
  await writeFile(path.join(work.dir, 'tool.exe'), 'MZ')
  await writeFile(path.join(work.dir, 'huge.log'), Buffer.alloc(MAX_ARTIFACT_BYTES + 1))
  await writeFile(path.join(outside.dir, 'id_rsa.txt'), 'key')
})
afterAll(async () => {
  await work.remove()
  await outside.remove()
})

describe('artifacts from the work folder', () => {
  it('reads an image inside the work folder', async () => {
    const artifact = await readArtifactFromWorkFolder(work.dir, 'shots/after.png')
    expect(artifact).toMatchObject({ relativePath: 'shots/after.png', mediaType: 'image/png' })
    expect(artifact.bytes).toHaveLength(4)
  })

  it('refuses files outside the work folder, ignored by git, of another type, too big, or missing', async () => {
    await expect(readArtifactFromWorkFolder(work.dir, path.join(outside.dir, 'id_rsa.txt'))).rejects.toThrow(/outside the work folder/)
    await expect(readArtifactFromWorkFolder(work.dir, '../' + path.basename(outside.dir) + '/id_rsa.txt')).rejects.toThrow(/outside the work folder/)
    await expect(readArtifactFromWorkFolder(work.dir, 'secret.txt')).rejects.toThrow(/ignored by git/)
    await expect(readArtifactFromWorkFolder(work.dir, 'tool.exe')).rejects.toThrow(/is none of the files Drillmaster keeps: images \(\.png .*\), text \(.*\.diff \.patch\) and source or test files \(\.js .*\.ts .*\.py /)
    await expect(readArtifactFromWorkFolder(work.dir, 'huge.log')).rejects.toThrow(/the limit is/)
    await expect(readArtifactFromWorkFolder(work.dir, 'nope.png')).rejects.toThrow(InvalidArtifact)
  })

  it('keeps a copy per work item, readable by name', async () => {
    const store = new FileArtifactStore(path.join(outside.dir, 'projects'))
    const saved = await store.save('p1', 'wi_1', await readArtifactFromWorkFolder(work.dir, 'shots/after.png'))
    expect(saved).toEqual({ name: 'shots_after.png', path: 'shots/after.png', media_type: 'image/png', bytes: 4 })
    expect(await store.read('p1', 'wi_1', 'shots_after.png')).toHaveLength(4)
    expect(await store.read('p1', 'wi_1', '../../escape')).toBeUndefined()
  })
})
