import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Drillmaster } from '../app.js'
import { portsFromEnv, repositoryOptionsFromEnv } from '../env.js'
import { projectServerInfoFile, readProjectServerInfo, runningProjectServer, type DaemonInfo } from '../projectLocator.js'
import { VERSION } from '../version.js'
import { listen } from './http.js'

const REPOSITORY_SYNC_INTERVAL_MS = 5 * 60_000

/** Runs the server of one project, announced in that project's daemon.json. */
export async function runDaemon(projectKeyOfServer: string, env: NodeJS.ProcessEnv = process.env) {
  const infoFile = projectServerInfoFile(projectKeyOfServer, env)
  await mkdir(path.dirname(infoFile), { recursive: true })

  const running = await runningProjectServer(projectKeyOfServer, env)
  if (running) {
    console.error(`Drillmaster already serves project ${projectKeyOfServer} at ${running}.`)
    return
  }

  const app = new Drillmaster(portsFromEnv(env), { recordRawHookPayloads: env.DRILLMASTER_RECORD === '1', repositories: repositoryOptionsFromEnv(env) })
  const server = await listen(app, Number(env.DRILLMASTER_PORT ?? 0), projectKeyOfServer)
  app.syncRepositoriesEvery(REPOSITORY_SYNC_INTERVAL_MS)
  const ownInfo: DaemonInfo = { port: server.port, pid: process.pid, url: server.url, version: VERSION }

  if (!(await claimInfoFile(infoFile, ownInfo, projectKeyOfServer, env))) {
    console.error('Another Drillmaster server for this project started at the same time; this one stops.')
    await server.close()
    return
  }
  console.error(`Drillmaster ${VERSION} serves project ${projectKeyOfServer} at ${server.url}.`)

  const stopServer = async () => {
    await server.close()
    try {
      const announcedInfo = JSON.parse(await readFile(infoFile, 'utf8')) as DaemonInfo
      if (announcedInfo.pid === process.pid) await rm(infoFile, { force: true })
    } catch {
      // The info file is already gone.
    }
    process.exit(0)
  }
  process.on('SIGINT', stopServer)
  process.on('SIGTERM', stopServer)
}

async function claimInfoFile(infoFile: string, ownInfo: DaemonInfo, projectKeyOfServer: string, env: NodeJS.ProcessEnv) {
  await rm(infoFile, { force: true })
  try {
    const handle = await open(infoFile, 'wx')
    await handle.writeFile(JSON.stringify(ownInfo))
    await handle.close()
    return true
  } catch {
    const otherInfo = await readProjectServerInfo(projectKeyOfServer, env)
    if (otherInfo && otherInfo.pid !== ownInfo.pid && (await runningProjectServer(projectKeyOfServer, env))) return false
    await writeFile(infoFile, JSON.stringify(ownInfo))
    return true
  }
}
