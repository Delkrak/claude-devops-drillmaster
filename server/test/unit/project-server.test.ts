import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectKey } from '../../src/adapters/projects.js'
import { RepositoryPublisher } from '../../src/adapters/repositoryPublisher.js'
import { workflowZero } from '../../src/core/workflow.js'
import { projectServerInfoFile } from '../../src/projectLocator.js'
import { CannotServeProject, findOrStartProjectServer, serverCommandFor, stopProjectServer, upgradeProject } from '../../src/projectServer.js'
import { VERSION } from '../../src/version.js'
import { OBJECTIVE, tempDir } from '../helpers.js'

let root: Awaited<ReturnType<typeof tempDir>>
let env: NodeJS.ProcessEnv
let work: string
let place: { url: string; folder: string }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

beforeAll(async () => {
  root = await tempDir('project-server')
  env = { ...process.env, DRILLMASTER_HOME: path.join(root.dir, 'home') }
  place = { url: path.join(root.dir, 'drillmaster.git'), folder: 'shop' }
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', place.url])
  work = path.join(root.dir, 'work')
  await mkdir(work)
  await writeFile(path.join(work, '.drillmaster'), JSON.stringify({ drillmaster_repository: place.url, folder: place.folder }))
  await RepositoryPublisher.forProject(path.join(root.dir, 'setup-clones'), projectKey(place), place, 'w_setup').setUp(workflowZero(OBJECTIVE as never), VERSION)
})
afterAll(() => root.remove())

describe("the server of a project, at the project's pinned version", () => {
  it("runs this plugin's own build for its own version and an earlier patch of it, and npx for any other", () => {
    expect(serverCommandFor(VERSION, 'shop-1')).toMatchObject({ command: process.execPath, args: expect.arrayContaining(['daemon', '--key', 'shop-1']) })
    const [major, minor, patch] = VERSION.split('.').map(Number)
    expect(serverCommandFor(`${major}.${minor}.0`, 'shop-1')).toMatchObject({ command: process.execPath })
    expect(serverCommandFor(`${major}.${minor}.${patch! + 1}`, 'shop-1')).toMatchObject({ command: 'npx' })
    expect(serverCommandFor('0.4.2', 'shop-1')).toMatchObject({ command: 'npx', args: ['-y', 'claude-devops-drillmaster@0.4.2', 'daemon', '--key', 'shop-1'] })
  })

  it("refuses a pin it can't run, saying why", () => {
    expect(() => serverCommandFor('latest', 'shop-1')).toThrow(/"latest" is not a version/)
    expect(() => serverCommandFor('0.2.0', 'shop-1')).toThrow(/Drillmaster 0.2.0 is pinned, but it can't run as the server of one project; 0.3.0 is the first that can/)
  })

  it("pins a version once the project's server stopped, and refuses one npm doesn't have", async () => {
    const key = projectKey(place)
    // A stand-in for the project's server: it answers /health as that project's server.
    const standIn = spawn(process.execPath, ['-e', `require('http').createServer((q, s) => s.end(JSON.stringify({ name: 'drillmaster', version: '0', pid: process.pid, project: '${key}' }))).listen(0, '127.0.0.1', function () { console.log(this.address().port) })`], { stdio: ['ignore', 'pipe', 'ignore'] })
    const port = await new Promise<string>((resolve) => standIn.stdout!.once('data', (data) => resolve(String(data).trim())))
    await mkdir(path.dirname(projectServerInfoFile(key, env)), { recursive: true })
    await writeFile(projectServerInfoFile(key, env), JSON.stringify({ port: Number(port), pid: standIn.pid, url: `http://127.0.0.1:${port}` }))
    const exited = new Promise((resolve) => standIn.on('exit', resolve))

    await expect(upgradeProject(work, '0.2.0', env)).rejects.toBeInstanceOf(CannotServeProject)
    await expect(upgradeProject(work, '0.4.0', env, async () => false)).rejects.toThrow(/npm has no claude-devops-drillmaster@0.4.0/)
    expect(await upgradeProject(work, '0.4.0', env, async () => true)).toMatchObject({ version: '0.4.0', stopped: true })
    expect(JSON.parse(git(place.url, 'show', 'main:shop/drillmaster.json'))).toEqual({ drillmaster_version: '0.4.0' })
    await exited
    expect(existsSync(projectServerInfoFile(key, env))).toBe(false)
  })

  it('stops no process that does not answer as the project\'s server', async () => {
    const key = projectKey(place)
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    await writeFile(projectServerInfoFile(key, env), JSON.stringify({ port: 1, pid: unrelated.pid, url: 'http://127.0.0.1:1' }))
    expect(await stopProjectServer(key, env)).toBe(false)
    expect(unrelated.exitCode).toBeNull()
    unrelated.kill()
  })

  it('reads the pin from main before it starts a server, and refuses one it cannot run', async () => {
    await RepositoryPublisher.forProject(path.join(root.dir, 'setup-clones'), projectKey(place), place, 'w_setup').pushPin('0.2.9')
    await expect(findOrStartProjectServer({ key: projectKey(place), place }, env)).rejects.toThrow(/Drillmaster 0.2.9 is pinned/)
  })
})
