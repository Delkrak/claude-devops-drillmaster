// `drillmaster daemon`: runs the one shared server and announces it in $DRILLMASTER_HOME/daemon.json.

import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Drillmaster } from '../app.js'
import { isHealthy, readDaemonInfo, type DaemonInfo } from '../client.js'
import { daemonFile, portsFromEnv } from '../env.js'
import { listen } from './http.js'

export async function runDaemon(env: NodeJS.ProcessEnv = process.env) {
  const file = daemonFile(env)
  await mkdir(path.dirname(file), { recursive: true })

  const existing = await readDaemonInfo(env)
  if (existing && (await isHealthy(existing.url))) {
    console.error(`Drillmaster is already running at ${existing.url} (pid ${existing.pid}).`)
    return
  }

  const server = await listen(new Drillmaster(portsFromEnv(env)), Number(env.DRILLMASTER_PORT ?? 0))
  const info: DaemonInfo = { port: server.port, pid: process.pid, url: server.url }

  // Claim daemon.json. If another server claimed it first and answers, step aside for it.
  if (!(await claim(file, info, existing))) {
    console.error('Another Drillmaster server started at the same time; this one stops.')
    await server.close()
    return
  }
  console.error(`Drillmaster is running at ${server.url} (home: ${path.dirname(file)}).`)

  const stop = async () => {
    await server.close()
    try {
      const current = JSON.parse(await readFile(file, 'utf8')) as DaemonInfo
      if (current.pid === process.pid) await rm(file, { force: true })
    } catch {
      // Nothing to clean up.
    }
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function claim(file: string, info: DaemonInfo, stale: DaemonInfo | undefined) {
  if (stale) await rm(file, { force: true })
  try {
    const handle = await open(file, 'wx')
    await handle.writeFile(JSON.stringify(info))
    await handle.close()
    return true
  } catch {
    const other = await readDaemonInfo()
    if (other && other.pid !== info.pid && (await isHealthy(other.url))) return false
    await writeFile(file, JSON.stringify(info))
    return true
  }
}
