import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DotDrillmasterResolver, projectKey } from './adapters/projects.js'
import { drillmasterServerAt } from './client.js'
import type { DrillmasterRepositoryPlace } from './ports.js'

/**
 * Finding a project's running server: light enough for every hook to load. Starting one is in
 * projectServer.ts.
 */
export const drillmasterHome = (env: NodeJS.ProcessEnv = process.env) => path.resolve(env.DRILLMASTER_HOME ?? path.join(os.homedir(), '.drillmaster'))

export interface DaemonInfo {
  port: number
  pid: number
  url: string
  version?: string
}

export const projectServerInfoFile = (projectKeyOfServer: string, env: NodeJS.ProcessEnv = process.env) =>
  path.join(drillmasterHome(env), 'projects', projectKeyOfServer, 'daemon.json')

export async function readProjectServerInfo(projectKeyOfServer: string, env: NodeJS.ProcessEnv = process.env): Promise<DaemonInfo | undefined> {
  try {
    return JSON.parse(await readFile(projectServerInfoFile(projectKeyOfServer, env), 'utf8')) as DaemonInfo
  } catch {
    return undefined
  }
}

/** The project's server, when the one its daemon.json names still runs and serves that project. */
export async function runningProjectServer(projectKeyOfServer: string, env: NodeJS.ProcessEnv = process.env) {
  const info = await readProjectServerInfo(projectKeyOfServer, env)
  const health = info && (await drillmasterServerAt(info.url))
  return health?.project === projectKeyOfServer && health.pid === info!.pid ? info!.url : undefined
}

export interface ProjectToServe {
  key: string
  place: DrillmasterRepositoryPlace
}

/** The project of a work folder, as its .drillmaster says, or of the setup about to make it one. */
export function projectToServe(projectDir: string, setupPlace?: DrillmasterRepositoryPlace): ProjectToServe | undefined {
  const linked = new DotDrillmasterResolver().resolve(projectDir)
  if (linked?.repository) return { key: linked.key, place: linked.repository }
  if (setupPlace) return { key: projectKey(setupPlace), place: setupPlace }
  return undefined
}
