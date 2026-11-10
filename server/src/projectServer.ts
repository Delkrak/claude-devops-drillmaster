import { spawn } from 'node:child_process'
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
/** The first Drillmaster that runs one server per project, which every pin must be at least. */
export const FIRST_PROJECT_SERVER_VERSION = '0.3.0'
export const NPM_PACKAGE = 'claude-devops-drillmaster'

export class CannotServeProject extends Error {}

/** The command that runs Drillmaster `version` as the server of one project. */
export function serverCommandFor(version: string, projectKeyOfServer: string) {
  if (!SEMVER.test(version)) throw new CannotServeProject(`The pinned Drillmaster version "${version}" is not a version (major.minor.patch).`)
  if (compareVersions(version, FIRST_PROJECT_SERVER_VERSION) < 0) {
    throw new CannotServeProject(`Drillmaster ${version} is pinned, but it can't run as the server of one project; ${FIRST_PROJECT_SERVER_VERSION} is the first that can. Pin a later one with \`drillmaster upgrade\`.`)
  }
  const daemonArgs = ['daemon', '--key', projectKeyOfServer]
  if (version === VERSION) {
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
  server.unref()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS))
    const started = await runningProjectServer(project.key, env)
    if (started) return started
  }
  throw new CannotServeProject(`Drillmaster ${version}, pinned in ${project.place.url} (${project.place.folder}/drillmaster.json), did not start within ${timeoutMs / 1000}s (${[command, ...args].join(' ')}).`)
}

/** Stops the project's running server, if one runs, so the next session starts the pinned version. */
export async function stopProjectServer(projectKeyOfServer: string, env: NodeJS.ProcessEnv = process.env) {
  const info = await readProjectServerInfo(projectKeyOfServer, env)
  if (!info) return false
  try {
    process.kill(info.pid)
  } catch {
    // It had stopped already.
  }
  await rm(projectServerInfoFile(projectKeyOfServer, env), { force: true })
  return true
}

/** Pins a Drillmaster version for the project: pushed to main first, then the running server stops. */
export async function upgradeProject(projectDir: string, version: string, env: NodeJS.ProcessEnv = process.env) {
  serverCommandFor(version, 'check')
  const project = projectToServe(projectDir)
  if (!project) throw new CannotServeProject(`${projectDir} is not a Drillmaster project: it has no .drillmaster file.`)
  const { writer, projectsRoot } = repositoryOptionsFromEnv(env)
  await RepositoryPublisher.forProject(projectsRoot, project.key, project.place, writer).pushPin(version)
  const stopped = await stopProjectServer(project.key, env)
  return { project, version, stopped }
}
