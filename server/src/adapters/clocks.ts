import { randomBytes, randomUUID } from 'node:crypto'
import type { Clock, Ids } from '../ports.js'

export const systemClock: Clock = { now: () => new Date().toISOString() }

/** A clock that starts at a fixed time and moves one second per call, so order stays visible. */
export function fixedClock(start: string): Clock {
  let t = Date.parse(start)
  if (Number.isNaN(t)) throw new Error(`Not a valid time for the fixed clock: ${start}`)
  return {
    now: () => {
      const iso = new Date(t).toISOString()
      t += 1000
      return iso
    },
  }
}

export const randomIds: Ids = {
  next: (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`,
  secret: () => randomBytes(24).toString('base64url'),
}

/** prefix_1, prefix_2 ... per prefix, and secret_1, secret_2 ...: deterministic ids for tests. */
export function sequentialIds(): Ids {
  const counters = new Map<string, number>()
  const next = (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    return `${prefix}_${n}`
  }
  return { next, secret: () => next('secret') }
}
