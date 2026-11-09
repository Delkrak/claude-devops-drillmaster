import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Drillmaster } from '../app.js'
import { isDrillmasterServerAt, readDaemonInfo, type DaemonInfo } from '../client.js'
import { daemonInfoFile, portsFromEnv } from '../env.js'
import { listen } from './http.js'

export async function runDaemon(env: NodeJS.ProcessEnv = process.env) {
  const infoFile = daemonInfoFile(env)
  await mkdir(path.dirname(infoFile), { recursive: true })

  const existingInfo = await readDaemonInfo(env)
  if (existingInfo && (await isDrillmasterServerAt(existingInfo.url))) {
    console.error(`Drillmaster is already running at ${existingInfo.url} (pid ${existingInfo.pid}).`)
    return
  }

  const app = new Drillmaster(portsFromEnv(env), { recordRawHookPayloads: env.DRILLMASTER_RECORD === '1' })
  const server = await listen(app, Number(env.DRILLMASTER_PORT ?? 0))
  const ownInfo: DaemonInfo = { port: server.port, pid: process.pid, url: server.url }

  if (!(await claimDaemonInfoFile(env, ownInfo, existingInfo))) {
    console.error('Another Drillmaster server started at the same time; this one stops.')
    await server.close()
    return
  }
  console.error(`Drillmaster is running at ${server.url} (home: ${path.dirname(infoFile)}).`)

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

async function claimDaemonInfoFile(env: NodeJS.ProcessEnv, ownInfo: DaemonInfo, staleInfo: DaemonInfo | undefined) {
  const infoFile = daemonInfoFile(env)
  if (staleInfo) await rm(infoFile, { force: true })
  try {
    const handle = await open(infoFile, 'wx')
    await handle.writeFile(JSON.stringify(ownInfo))
    await handle.close()
    return true
  } catch {
    const otherInfo = await readDaemonInfo(env)
    if (otherInfo && otherInfo.pid !== ownInfo.pid && (await isDrillmasterServerAt(otherInfo.url))) return false
    await writeFile(infoFile, JSON.stringify(ownInfo))
    return true
  }
}
