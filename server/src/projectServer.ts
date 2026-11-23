import { execFile, spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RepositoryPublisher } from './adapters/repositoryPublisher.js'
import { compareVersions, SEMVER } from './core/workflow.js'
import { repositoryOptionsFromEnv } from './env.js'
import type { DrillmasterRepositoryPlace } from './ports.js'
import { projectServerInfoFile, projectToServe, readProjectServerInfo, runningProjectServer, type ProjectToServe } from './projectLocator.js'
import { VERSION } from './version.js'

const START_POLL_MS = 150
const OWN_BUILD_START_TIMEOUT_MS = 15_000
const NPX_START_TIMEOUT_MS = 180_000
const STOP_TIMEOUT_MS = 10_000
const NPM_VIEW_TIMEOUT_MS = 30_000
/** The first Drillmaster that runs one server per project, which every pin must be at least. */
export const FIRST_PROJECT_SERVER_VERSION = '0.3.0'
export const NPM_PACKAGE = 'claude-devops-drillmaster'

export class CannotServeProject extends Error {}

/** A patch release runs the projects pinned to an earlier patch of its own minor version: 0.3.1 serves 0.3.0. */
export const ownBuildServes = (pinnedVersion: string) => {
  const [major, minor] = VERSION.split('.')
  const [pinnedMajor, pinnedMinor] = pinnedVersion.split('.')
  return pinnedMajor === major && pinnedMinor === minor && compareVersions(pinnedVersion, VERSION) <= 0
}

/** The command that runs Drillmaster `version` as the server of one project. */
export function serverCommandFor(version: string, projectKeyOfServer: string) {
  if (!SEMVER.test(version)) throw new CannotServeProject(`The pinned Drillmaster version "${version}" is not a version (major.minor.patch).`)
  if (compareVersions(version, FIRST_PROJECT_SERVER_VERSION) < 0) {
    throw new CannotServeProject(`Drillmaster ${version} is pinned, but it can't run as the server of one project; ${FIRST_PROJECT_SERVER_VERSION} is the first that can. Pin a later one with \`drillmaster upgrade\`.`)
  }
  const daemonArgs = ['daemon', '--key', projectKeyOfServer]
  if (ownBuildServes(version)) {
    const thisModule = fileURLToPath(import.meta.url)
    return { command: process.execPath, args: [...process.execArgv, path.join(path.dirname(thisModule), `cli${path.extname(thisModule)}`), ...daemonArgs], timeoutMs: OWN_BUILD_START_TIMEOUT_MS }
  }
  return { command: 'npx', args: ['-y', `${NPM_PACKAGE}@${version}`, ...daemonArgs], timeoutMs: NPX_START_TIMEOUT_MS, shell: process.platform === 'win32' }
}

/** The Drillmaster version pinned on main of the project's Drillmaster repository; this one's when there is no pin yet. */
async function pinnedVersion(key: string, place: DrillmasterRepositoryPlace, env: NodeJS.ProcessEnv) {
  const { writer, projectsRoot } = repositoryOptionsFromEnv(env)
  return (await RepositoryPublisher.forProject(projectsRoot, key, place, writer).readPin()) ?? VERSION
}

/**
 * The URL of the project's server. When none runs, it starts one at the version pinned in the
 * project's Drillmaster repository: this plugin's own build when that is the pin, npx otherwise.
 */
export async function findOrStartProjectServer(project: ProjectToServe, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const running = await runningProjectServer(project.key, env)
  if (running) return running
  const version = await pinnedVersion(project.key, project.place, env)
  const { command, args, timeoutMs, shell } = serverCommandFor(version, project.key)
  const server = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env, shell })
  let startError: Error | undefined
  server.on('error', (error) => (startError = error))
  server.unref()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS))
    if (startError) throw new CannotServeProject(`Drillmaster ${version}, pinned for this project, could not start (${[command, ...args].join(' ')}): ${startError.message}`)
    const started = await runningProjectServer(project.key, env)
    if (started) return started
  }
  throw new CannotServeProject(`Drillmaster ${version}, pinned in ${project.place.url} (${project.place.folder}/drillmaster.json), did not start within ${timeoutMs / 1000}s (${[command, ...args].join(' ')}).`)
}

/**
 * Stops the project's running server, so the next session starts the pinned version. Only a
 * process that answers as that project's server is stopped; a file left by one that stopped is removed.
 */
export async function stopProjectServer(projectKeyOfServer: string, env: NodeJS.ProcessEnv = process.env) {
  const info = await readProjectServerInfo(projectKeyOfServer, env)
  if (!info) return false
  const running = await runningProjectServer(projectKeyOfServer, env)
  if (running) {
    process.kill(info.pid)
    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (Date.now() < deadline && (await runningProjectServer(projectKeyOfServer, env))) await new Promise((resolve) => setTimeout(resolve, START_POLL_MS))
  }
  await rm(projectServerInfoFile(projectKeyOfServer, env), { force: true })
  return running !== undefined
}

/** Whether npm has Drillmaster `version`, so a pin to it can be started everywhere. */
function isPublished(version: string) {
  return new Promise<boolean>((resolve) => {
    execFile('npm', ['view', `${NPM_PACKAGE}@${version}`, 'version'], { shell: process.platform === 'win32', timeout: NPM_VIEW_TIMEOUT_MS, windowsHide: true }, (error, stdout) =>
      resolve(!error && stdout.trim() === version),
    )
  })
}

/**
 * Pins a Drillmaster version for the project. The running server stops first, so nothing else writes
 * to the project's clone; the pin applies once main has it, at the next session.
 */
export async function upgradeProject(projectDir: string, version: string, env: NodeJS.ProcessEnv = process.env, published: (version: string) => Promise<boolean> = isPublished) {
  serverCommandFor(version, 'check')
  const project = projectToServe(projectDir)
  if (!project) throw new CannotServeProject(`${projectDir} is not a Drillmaster project: it has no .drillmaster file.`)
  if (!ownBuildServes(version) && !(await published(version))) {
    throw new CannotServeProject(`npm has no ${NPM_PACKAGE}@${version}, so no machine could start it. Pin a published version, or this one (${VERSION}).`)
  }
  const stopped = await stopProjectServer(project.key, env)
  const { writer, projectsRoot } = repositoryOptionsFromEnv(env)
  await RepositoryPublisher.forProject(projectsRoot, project.key, project.place, writer).pushPin(version)
  return { project, version, stopped }
}
