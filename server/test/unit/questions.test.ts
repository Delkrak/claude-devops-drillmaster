import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { handleHook } from '../../src/core/hooks.js'
import { measureDeliveredItems } from '../../src/core/measures.js'
import { askUserQuestionInput, pendingOwnerQuestions } from '../../src/core/questions.js'
import { foldState } from '../../src/core/state.js'
import type { WorkflowDocument } from '../../src/core/workflow.js'
import { WORKFLOW_3 } from '../helpers.js'

const at = '2026-11-09T10:00:00Z'
const MOOD: WorkflowDocument['metrics'][number] = {
  name: 'value',
  categories: [
    { value: 'low', description: 'nice to have' },
    { value: 'high', description: 'Owner needs it' },
  ],
  at: { stage: 1, step: 1 },
  by: 'owner',
  instruction: 'How much is this worth to you?',
}
const WORKFLOW: WorkflowDocument = { ...WORKFLOW_3, version: '1.0.0', metrics: [MOOD] }
const asEvents = (events: object[]) => events.map((event, i) => ({ id: `x${i}`, at, ...event })) as DrillmasterEvent[]

const base = asEvents([
  { type: 'project_initialized', dir: '/p', workflow: WORKFLOW },
  { type: 'work_item_started', work_item_id: 'wi_1', issue: '#7', workflow_version: '1.0.0', token_hash: 'h', stage: 1, step: 1 },
  { type: 'session_registered', session_id: 's1', source: 'startup' },
  { type: 'session_bound', session_id: 's1', work_item_id: 'wi_1' },
  { type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 1, accepted: true, by: 'agent', why: 'ok', rule: null, next: { stage: 1, step: 2 }, done: false },
  { type: 'gate_verdict', work_item_id: 'wi_1', stage: 1, step: 2, accepted: true, by: 'agent', why: 'ok', rule: null, next: { stage: 2, step: 1 }, done: false },
  { type: 'gate_submitted', work_item_id: 'wi_1', stage: 2, step: 1, gate: 'owner', self_check: [], text: 'PR #40' },
])
const GATE_QUESTION = 'Owner gate of wi_1 (#7), work step 2.1 "Owner approves": does the work meet pr 1.1?'
const METRIC_QUESTION = 'Metric "value" for wi_1 (#7): How much is this worth to you?'

const hook = (events: DrillmasterEvent[], hookEvent: string, payload: Record<string, unknown>) => handleHook(foldState(events), hookEvent, { session_id: 's1', ...payload }, false)
const ask = (events: DrillmasterEvent[], toolUseId: string, input: Record<string, unknown>) =>
  hook(events, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: toolUseId, tool_input: input })
const answered = (events: DrillmasterEvent[], toolUseId: string, answers: Record<string, string>, annotations: Record<string, unknown> = {}) =>
  hook(events, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: toolUseId, tool_input: { answers }, tool_response: { answers, annotations } })

describe("Owner's pending questions", () => {
  it('asks the Owner gate, and the metric Owner takes at a step already passed', () => {
    const questions = pendingOwnerQuestions(foldState(base))
    expect(questions.map((question) => [question.kind, question.question])).toEqual([
      ['owner_gate', GATE_QUESTION],
      ['owner_metric', METRIC_QUESTION],
    ])
    expect(askUserQuestionInput(questions).questions[1]).toEqual({
      question: METRIC_QUESTION,
      header: 'value',
      options: [
        { label: 'low', description: 'nice to have' },
        { label: 'high', description: 'Owner needs it' },
      ],
      multiSelect: false,
    })
  })

  it('asks one question per open proposal', () => {
    const retro = asEvents([
      {
        type: 'retrospective_ran',
        retro_id: 'retro_1',
        work_items: [],
        findings: { should: '', did: '', why: '', keep: '', improve: '' },
        proposals: [
          { id: 1, change: 'add a lint step', purpose: 'Owner fixed lint', hypothesis: 'no more lint fixes', measure: 'owner_corrections_per_item', ops: [] },
          { id: 2, change: 'time it', purpose: 'see speed', measure: 'minutes_per_item', ops: [] },
        ],
      },
      { type: 'owner_decided', retro_id: 'retro_1', approved: [], declined: [2], prompt: 'not 2' },
    ])
    const proposals = pendingOwnerQuestions(foldState([...base, ...retro])).filter((question) => question.kind === 'proposal')
    expect(proposals).toEqual([
      expect.objectContaining({
        question: 'Proposal 1 of retro_1: add a lint step. Approve it?',
        header: 'Proposal 1',
        options: [
          { label: 'Approve', description: 'Owner fixed lint Hypothesis: no more lint fixes' },
          { label: 'Decline', description: 'Leave the workflow as it is.' },
        ],
      }),
    ])
  })
})

describe('Owner decides through AskUserQuestion', () => {
  const askedEvents = [...base, ...asEvents(ask(base, 'tu_1', { questions: [{ question: GATE_QUESTION }, { question: METRIC_QUESTION }] }).events)]

  it('records the clean call in PreToolUse', () => {
    expect(askedEvents.filter((event) => event.type === 'owner_asked')).toEqual([expect.objectContaining({ tool_use_id: 'tu_1', questions: [GATE_QUESTION, METRIC_QUESTION] })])
  })

  it('refuses a call whose input already carries the answers', () => {
    const outcome = ask(base, 'tu_2', { questions: [{ question: GATE_QUESTION }], answers: { [GATE_QUESTION]: 'Approve' } })
    expect(outcome.output).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } })
    expect(outcome.events.some((event) => event.type === 'owner_asked')).toBe(false)
  })

  it("records Owner's choices, with the note, and tells Agent", () => {
    const outcome = answered(askedEvents, 'tu_1', { [GATE_QUESTION]: 'Approve', [METRIC_QUESTION]: 'high' }, { [GATE_QUESTION]: { notes: 'nice work' } })
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'gate_verdict', accepted: true, by: 'owner', via: 'question', why: 'Owner: "Approve - nice work"', done: true }))
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'metric_recorded', name: 'value', value: 'high', by: 'owner' }))
    expect((outcome.output as any).hookSpecificOutput.additionalContext).toMatch(/Owner approved the Owner gate of work step 2.1\. Every work gate has passed/)
  })

  it('ignores answers to a call PreToolUse never saw: Agent cannot answer for Owner', () => {
    const outcome = answered(base, 'tu_9', { [GATE_QUESTION]: 'Approve' })
    expect(outcome.events.filter((event) => event.type === 'gate_verdict')).toEqual([])
  })

  it('reads an answer Owner typed, and leaves an unclear one pending with Owner\'s words for Agent', () => {
    const rejected = answered(askedEvents, 'tu_1', { [GATE_QUESTION]: 'no, the PR has no description' })
    expect(rejected.events).toContainEqual(expect.objectContaining({ type: 'gate_verdict', accepted: false, via: 'question' }))
    const unclear = answered(askedEvents, 'tu_1', { [GATE_QUESTION]: 'what does step 2 cover?' })
    expect(unclear.events.filter((event) => event.type === 'gate_verdict')).toEqual([])
    expect((unclear.output as any).hookSpecificOutput.additionalContext).toMatch(/does not decide it\. Answer Owner, then ask again/)
  })

  it('still takes a typed prompt for the Owner gate', () => {
    const outcome = hook(base, 'UserPromptSubmit', { prompt: 'looks good' })
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'gate_verdict', accepted: true, via: 'prompt' }))
  })
})

describe("Owner's corrections, whatever the channel", () => {
  const delivered = asEvents([{ type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#40' }])
  const verdict = (accepted: boolean, via: 'question' | 'prompt') =>
    asEvents([{ type: 'gate_verdict', work_item_id: 'wi_1', stage: 2, step: 1, accepted, by: 'owner', via, why: 'w', rule: null, next: { stage: null, step: null }, done: accepted }])
  const prompt = asEvents([{ type: 'work_trace', session_id: 's1', work_item_id: 'wi_1', stage: 2, step: 1, hook: 'UserPromptSubmit', prompt: 'p' }])
  const corrections = (events: DrillmasterEvent[]) => measureDeliveredItems([...base, ...events, ...delivered])[0]!.values.owner_corrections_per_item

  it('counts no correction for an approval, and one for a rejection', () => {
    expect(corrections(verdict(true, 'question'))).toBe(0)
    expect(corrections([...prompt, ...verdict(true, 'prompt')])).toBe(0)
    expect(corrections(verdict(false, 'question'))).toBe(1)
    expect(corrections([...prompt, ...verdict(false, 'prompt')])).toBe(1)
  })
})
