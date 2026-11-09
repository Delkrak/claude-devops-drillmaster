import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent, GateSubmitted } from '../../src/core/events.js'
import { buildGatePrompt, extractFirstJsonObject, InvalidAnswer, readGateAnswer } from '../../src/core/review.js'
import { foldState } from '../../src/core/state.js'
import { WORKFLOW_DM } from '../helpers.js'

const at = '2026-11-09T10:00:00Z'
const submission: GateSubmitted = {
  id: 'g1',
  at,
  type: 'gate_submitted',
  work_item_id: 'wi_1',
  stage: 1,
  step: 2,
  gate: 'drillmaster',
  self_check: [{ rule: 'pr 1.1', accepted: true, evidence: 'PR body has a What section' }],
  text: 'adds CSV export',
}
const events: DrillmasterEvent[] = [
  { id: 'e0', at, type: 'project_initialized', dir: '/p', workflow: WORKFLOW_DM },
  { id: 's', at, type: 'work_item_started', work_item_id: 'wi_1', issue: '#7', workflow_version: '1.0.0', token_hash: 'h', stage: 1, step: 2 },
  { id: 't1', at, type: 'work_trace', session_id: 's1', work_item_id: 'wi_1', stage: 1, step: 2, hook: 'PostToolUse', tool: 'Bash', input: '{"command":"gh pr create"}', error: false },
  { id: 'r1', at, type: 'work_reported', work_item_id: 'wi_1', stage: 1, step: 1, kind: 'assumption', text: 'CSV uses ;' },
  submission,
]

describe('the Drillmaster gate prompt', () => {
  const prompt = buildGatePrompt(WORKFLOW_DM, foldState(events).workItems.wi_1!, submission, events)

  it('gives the rules in full, the new report, the earlier reports and the work traces', () => {
    expect(prompt).toContain('- pr 1.1: the PR says what it changes (verified by reading the PR description)')
    expect(prompt).toContain('PR body has a What section')
    expect(prompt).toContain('CSV uses ;')
    expect(prompt).toContain('PostToolUse Bash {"command":"gh pr create"}')
    expect(prompt).toContain('Answer with JSON only')
  })

  it('does not repeat the new report among the earlier ones', () => {
    expect(prompt.match(/adds CSV export/g)).toHaveLength(1)
  })
})

describe("reading Drillmaster's answer", () => {
  it('accepts and moves on', () => {
    expect(readGateAnswer(WORKFLOW_DM, submission, { accepted: true, rule: null, why: 'ok' }).verdict).toEqual({
      accepted: true,
      why: 'ok',
      rule: null,
      next: { stage: 2, step: 1 },
      done: false,
    })
  })

  it('rejects citing the rule, back to where Drillmaster says, never forward', () => {
    expect(readGateAnswer(WORKFLOW_DM, submission, { accepted: false, rule: 'pr 1.1', why: 'no What', back_to: { stage: 1, step: 1 } }).verdict.next).toEqual({ stage: 1, step: 1 })
    expect(readGateAnswer(WORKFLOW_DM, submission, { accepted: false, rule: 'pr 1.1', why: 'x', back_to: { stage: 2, step: 1 } }).verdict.next).toEqual({ stage: 1, step: 2 })
    expect(readGateAnswer(WORKFLOW_DM, submission, { accepted: false, rule: 'pr 1.1', why: 'x' }).verdict.next).toEqual({ stage: 1, step: 2 })
  })

  it('reads a JSON answer wrapped in prose', () => {
    const text = 'Verdict:\n```json\n{"accepted": false, "rule": "pr 1.1", "why": "The PR body is empty."}\n```'
    expect(readGateAnswer(WORKFLOW_DM, submission, text).verdict).toMatchObject({ accepted: false, rule: 'pr 1.1' })
    expect(extractFirstJsonObject('no json here')).toBeUndefined()
  })

  it('refuses answers that are not verdicts, or rejections that cite no rule', () => {
    expect(() => readGateAnswer(WORKFLOW_DM, submission, 'I think it is fine')).toThrow(InvalidAnswer)
    expect(() => readGateAnswer(WORKFLOW_DM, submission, { accepted: true })).toThrow(InvalidAnswer)
    expect(() => readGateAnswer(WORKFLOW_DM, submission, { accepted: false, rule: 'made up', why: 'x' })).toThrow(/must cite/)
  })
})
