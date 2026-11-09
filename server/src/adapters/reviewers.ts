import { readFileSync } from 'node:fs'
import type { Reviewer, ReviewRequest } from '../ports.js'

/**
 * Answers from a script instead of a model, so Drillmaster gates, post mortems and retrospectives
 * are deterministic in tests. The script maps a request kind to a queue of answers; each request
 * takes the next one. Every request is kept in `requests` for assertions.
 */
export class ScriptedReviewer implements Reviewer {
  readonly requests: ReviewRequest[] = []
  private readonly queues: Map<string, unknown[]>

  constructor(script: Record<string, unknown[]>) {
    this.queues = new Map(Object.entries(script).map(([kind, answers]) => [kind, [...answers]]))
  }

  static fromFile(file: string) {
    return new ScriptedReviewer(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown[]>)
  }

  async review(request: ReviewRequest) {
    this.requests.push(request)
    const queue = this.queues.get(request.kind)
    if (!queue || queue.length === 0) {
      throw new Error(`The scripted reviewer has no answer left for "${request.kind}".`)
    }
    return { answer: queue.shift() }
  }
}

/** DRILLMASTER_REVIEWER=none: every review fails, so Drillmaster gates stay pending. */
export class UnavailableReviewer implements Reviewer {
  async review(request: ReviewRequest): Promise<never> {
    throw new Error(`No reviewer is configured to judge "${request.kind}".`)
  }
}
