import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { ClaudeReviewer } from './adapters/claudeReviewer.js'
import { randomIds, steppingClock, systemClock } from './adapters/clocks.js'
import { ScriptedReviewer, UnavailableReviewer } from './adapters/reviewers.js'
import { FileArtifactStore } from './adapters/artifacts.js'
import { JsonlStore } from './adapters/stores.js'
import type { Ports } from './ports.js'

const MAX_READABLE_NAME_LENGTH = 40

export const drillmasterHome = (env: NodeJS.ProcessEnv = process.env) =>
  path.resolve(env.DRILLMASTER_HOME ?? path.join(os.homedir(), '.drillmaster'))

export const daemonInfoFile = (env: NodeJS.ProcessEnv = process.env) => path.join(drillmasterHome(env), 'daemon.json')

export function projectId(projectDir: string) {
  let normalizedDir = path.resolve(projectDir)
  if (process.platform === 'win32') normalizedDir = normalizedDir.toLowerCase()
  const readableName = path.basename(normalizedDir).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_READABLE_NAME_LENGTH) || 'project'
  return `${readableName}-${createHash('sha256').update(normalizedDir).digest('hex').slice(0, 12)}`
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
  }
}
