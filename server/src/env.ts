import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ClaudeReviewer } from './adapters/claudeReviewer.js'
import { randomIds, steppingClock, systemClock } from './adapters/clocks.js'
import { ScriptedReviewer, UnavailableReviewer } from './adapters/reviewers.js'
import { FileArtifactStore } from './adapters/artifacts.js'
import { DotDrillmasterResolver } from './adapters/projects.js'
import { drillmasterHome } from './projectLocator.js'
import { JsonlStore } from './adapters/stores.js'
import type { Ports } from './ports.js'



/** This server's name in Drillmaster repositories: made once per Drillmaster home, so a machine keeps it. */
export function repositoryOptionsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const home = drillmasterHome(env)
  const writerFile = path.join(home, 'writer.json')
  let writer: string
  try {
    writer = (JSON.parse(readFileSync(writerFile, 'utf8')) as { writer: string }).writer
  } catch {
    writer = `w_${randomUUID().slice(0, 8)}`
    mkdirSync(home, { recursive: true })
    writeFileSync(writerFile, JSON.stringify({ writer }) + '\n')
  }
  return { writer, projectsRoot: path.join(home, 'projects') }
}

const secondsToMs = (seconds: string | undefined) => (seconds ? Number(seconds) * 1000 : undefined)

export function portsFromEnv(env: NodeJS.ProcessEnv = process.env): Ports {
  const clockSetting = env.DRILLMASTER_CLOCK ?? 'system'
  const reviewerSetting = env.DRILLMASTER_REVIEWER ?? 'claude'
  return {
    store: new JsonlStore(path.join(drillmasterHome(env), 'projects')),
    artifacts: new FileArtifactStore(path.join(drillmasterHome(env), 'projects')),
    clock: clockSetting.startsWith('fixed:') ? steppingClock(clockSetting.slice('fixed:'.length)) : systemClock,
    ids: randomIds,
    reviewer: reviewerSetting.startsWith('scripted:')
      ? ScriptedReviewer.fromFile(reviewerSetting.slice('scripted:'.length))
      : reviewerSetting === 'claude'
        ? new ClaudeReviewer({
            command: env.DRILLMASTER_CLAUDE ?? 'claude',
            model: env.DRILLMASTER_REVIEW_MODEL,
            timeoutPerAttemptMs: secondsToMs(env.DRILLMASTER_REVIEW_TIMEOUT),
            attempts: env.DRILLMASTER_REVIEW_ATTEMPTS ? Number(env.DRILLMASTER_REVIEW_ATTEMPTS) : undefined,
          })
        : new UnavailableReviewer(),
    projects: new DotDrillmasterResolver(),
  }
}
