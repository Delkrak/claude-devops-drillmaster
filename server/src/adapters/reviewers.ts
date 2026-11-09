import { readFileSync } from 'node:fs'
import type { Reviewer, ReviewRequest } from '../ports.js'

export class ScriptedReviewer implements Reviewer {
  readonly requests: ReviewRequest[] = []
  private readonly answersByKind: Map<string, unknown[]>

  constructor(answersByKind: Record<string, unknown[]>) {
    this.answersByKind = new Map(Object.entries(answersByKind).map(([kind, answers]) => [kind, [...answers]]))
  }

  enqueue(kind: string, ...answers: unknown[]) {
    this.answersByKind.set(kind, [...(this.answersByKind.get(kind) ?? []), ...answers])
  }

  static fromFile(scriptFile: string) {
    return new ScriptedReviewer(JSON.parse(readFileSync(scriptFile, 'utf8')) as Record<string, unknown[]>)
  }

  async review(request: ReviewRequest) {
    this.requests.push(request)
    const answers = this.answersByKind.get(request.kind)
    if (!answers || answers.length === 0) {
      throw new Error(`The scripted reviewer has no answer left for "${request.kind}".`)
    }
    return { answer: answers.shift() }
  }
}

export class UnavailableReviewer implements Reviewer {
  async review(request: ReviewRequest): Promise<never> {
    throw new Error(`No reviewer is configured to judge "${request.kind}".`)
  }
}
