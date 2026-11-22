import { randomBytes, randomUUID } from 'node:crypto'
import type { Clock, Ids } from '../ports.js'

const STEP_MS = 1000

export const systemClock: Clock = { now: () => new Date().toISOString() }

export function steppingClock(startAt: string): Clock {
  let currentMs = Date.parse(startAt)
  if (Number.isNaN(currentMs)) throw new Error(`Not a valid time for the stepping clock: ${startAt}`)
  return {
    now: () => {
      const timestamp = new Date(currentMs).toISOString()
      currentMs += STEP_MS
      return timestamp
    },
  }
}

export const randomIds: Ids = {
  next: (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`,
  secret: () => randomBytes(24).toString('base64url'),
}

export function sequentialIds(): Ids {
  const countByPrefix = new Map<string, number>()
  const next = (prefix: string) => {
    const count = (countByPrefix.get(prefix) ?? 0) + 1
    countByPrefix.set(prefix, count)
    return `${prefix}_${count}`
  }
  return { next, secret: () => next('secret') }
}
