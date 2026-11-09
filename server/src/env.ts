// Where the server lives and which adapters it uses, all from the environment, so every test and
// every simulation run can get its own isolated server.

import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fixedClock, randomIds, systemClock } from './adapters/clocks.js'
import { ClaudeReviewer } from './adapters/claudeReviewer.js'
import { ScriptedReviewer, UnavailableReviewer } from './adapters/reviewers.js'
import { JsonlStore } from './adapters/stores.js'
import type { Ports } from './ports.js'

export const home = (env: NodeJS.ProcessEnv = process.env) =>
  path.resolve(env.DRILLMASTER_HOME ?? path.join(os.homedir(), '.drillmaster'))

export const daemonFile = (env: NodeJS.ProcessEnv = process.env) => path.join(home(env), 'daemon.json')

/** One stable id per project directory. Windows paths compare case-insensitively. */
export function projectId(dir: string) {
  let normalized = path.resolve(dir)
  if (process.platform === 'win32') normalized = normalized.toLowerCase()
  const name = path.basename(normalized).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'project'
  return `${name}-${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`
}

/** The production adapters, unless DRILLMASTER_CLOCK or DRILLMASTER_REVIEWER say otherwise. */
export function portsFromEnv(env: NodeJS.ProcessEnv = process.env): Ports {
  const clockSetting = env.DRILLMASTER_CLOCK ?? 'system'
  const reviewerSetting = env.DRILLMASTER_REVIEWER ?? 'claude'
  return {
    store: new JsonlStore(path.join(home(env), 'projects')),
    clock: clockSetting.startsWith('fixed:') ? fixedClock(clockSetting.slice('fixed:'.length)) : systemClock,
    ids: randomIds,
    reviewer: reviewerSetting.startsWith('scripted:')
      ? ScriptedReviewer.fromFile(reviewerSetting.slice('scripted:'.length))
      : reviewerSetting === 'claude'
        ? new ClaudeReviewer({
            command: env.DRILLMASTER_CLAUDE ?? 'claude',
            model: env.DRILLMASTER_REVIEW_MODEL,
            timeoutMs: env.DRILLMASTER_REVIEW_TIMEOUT ? Number(env.DRILLMASTER_REVIEW_TIMEOUT) * 1000 : undefined,
            attempts: env.DRILLMASTER_REVIEW_ATTEMPTS ? Number(env.DRILLMASTER_REVIEW_ATTEMPTS) : undefined,
          })
        : new UnavailableReviewer(),
  }
}
