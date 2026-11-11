import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { handleHook } from '../../src/core/hooks.js'
import { measureDeliveredItems } from '../../src/core/measures.js'
import { askUserQuestionInput, pendingOwnerQuestions } from '../../src/core/questions.js'
import { foldState } from '../../src/core/state.js'
import type { WorkflowDocument } from '../../src/core/workflow.js'
import { WORKFLOW_3 } from '../helpers.js'

const at = '2026-11-09T10:00:00Z'
const MOOD: WorkflowDocument['inputs'][number] = {
  name: 'value',
  options: [
    { value: 'low', description: 'nice to have' },
    { value: 'high', description: 'Owner needs it' },
  ],
  guid: 'guid-input',
  set_at: '1.1',
  by: 'owner',
  instruction: 'How much is this worth to you?',
}
const WORKFLOW: WorkflowDocument = { ...WORKFLOW_3, version: '1.0.0', inputs: [MOOD] }
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
const INPUT_QUESTION = 'Input "value" for wi_1 (#7): How much is this worth to you?'

const hook = (events: DrillmasterEvent[], hookEvent: string, payload: Record<string, unknown>) => handleHook(foldState(events), hookEvent, { session_id: 's1', ...payload }, false)
const ask = (events: DrillmasterEvent[], toolUseId: string, input: Record<string, unknown>) =>
  hook(events, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: toolUseId, tool_input: input })
const answered = (events: DrillmasterEvent[], toolUseId: string, answers: Record<string, string>, annotations: Record<string, unknown> = {}) =>
  hook(events, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: toolUseId, tool_input: { answers }, tool_response: { answers, annotations } })

describe("Owner's pending questions", () => {
  it('asks the Owner gate, and the input Owner sets at a step already passed', () => {
    const questions = pendingOwnerQuestions(foldState(base))
    expect(questions.map((question) => [question.kind, question.question])).toEqual([
      ['owner_gate', GATE_QUESTION],
      ['owner_input', INPUT_QUESTION],
    ])
    expect(askUserQuestionInput(questions).questions[1]).toEqual({
      question: INPUT_QUESTION,
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
          { id: 1, change: 'add a lint step', purpose: 'Owner fixed lint', hypothesis: 'no more lint fixes', measure: 'owner_friction_per_item', ops: [] },
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
          { label: 'Decline', description: 'Leave the workflow as it is. A note on Approve declines it too.' },
        ],
      }),
    ])
  })
})

describe('Owner decides through AskUserQuestion', () => {
  const askedEvents = [...base, ...asEvents(ask(base, 'tu_1', { questions: [{ question: GATE_QUESTION }, { question: INPUT_QUESTION }] }).events)]

  it('records the clean call in PreToolUse', () => {
    expect(askedEvents.filter((event) => event.type === 'owner_asked')).toEqual([expect.objectContaining({ tool_use_id: 'tu_1', questions: [GATE_QUESTION, INPUT_QUESTION] })])
  })

  it('refuses a call whose input already carries the answers', () => {
    const outcome = ask(base, 'tu_2', { questions: [{ question: GATE_QUESTION }], answers: { [GATE_QUESTION]: 'Approve' } })
    expect(outcome.output).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } })
    expect(outcome.events.some((event) => event.type === 'owner_asked')).toBe(false)
  })

  it("records Owner's choices, and tells Agent", () => {
    const outcome = answered(askedEvents, 'tu_1', { [GATE_QUESTION]: 'Approve', [INPUT_QUESTION]: 'high' }, { [INPUT_QUESTION]: { notes: 'a customer asked' } })
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'gate_verdict', accepted: true, by: 'owner', via: 'question', why: 'Owner approved.', done: true }))
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'input_set', name: 'value', value: 'high', explanation: 'a customer asked', by: 'owner' }))
    expect((outcome.output as any).hookSpecificOutput.additionalContext).toMatch(/Owner approved the Owner gate of step 2.1\. Every work gate has passed/)
  })

  it('takes a note on Approve as a rejection: Owner either approves or not', () => {
    const outcome = answered(askedEvents, 'tu_1', { [GATE_QUESTION]: 'Approve' }, { [GATE_QUESTION]: { notes: 'but rename the file' } })
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'gate_verdict', accepted: false, by: 'owner', why: 'Owner rejected: "but rename the file"', next: { stage: 2, step: 1 } }))
  })

  it('ignores answers to a call PreToolUse never saw: Agent cannot answer for Owner', () => {
    const outcome = answered(base, 'tu_9', { [GATE_QUESTION]: 'Approve' })
    expect(outcome.events.filter((event) => event.type === 'gate_verdict')).toEqual([])
  })

  it('takes any answer Owner typed as a rejection, with the words as the reason; no word means yes', () => {
    for (const typed of ['looks good, ship it', 'what does step 2 cover?']) {
      const outcome = answered(askedEvents, 'tu_1', { [GATE_QUESTION]: typed })
      expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'gate_verdict', accepted: false, via: 'question', why: `Owner rejected: "${typed}"` }))
    }
  })

  it('leaves an input open when Owner types something that is none of its options', () => {
    const outcome = answered(askedEvents, 'tu_1', { [INPUT_QUESTION]: 'quite high' })
    expect(outcome.events.filter((event) => event.type === 'input_set')).toEqual([])
    expect((outcome.output as any).hookSpecificOutput.additionalContext).toMatch(/none of its options, so it stays open/)
  })

  it('decides nothing from a chat prompt, however it sounds', () => {
    const outcome = hook(base, 'UserPromptSubmit', { prompt: 'looks good, approve' })
    expect(outcome.events.map((event) => event.type)).toEqual(['work_trace'])
    expect(outcome.output).toBeUndefined()
  })
})

describe("Owner's corrections, whatever the channel", () => {
  const delivered = asEvents([{ type: 'work_item_delivered', work_item_id: 'wi_1', pr: '#40' }])
  const verdict = (accepted: boolean, via: 'question' | 'prompt') =>
    asEvents([{ type: 'gate_verdict', work_item_id: 'wi_1', stage: 2, step: 1, accepted, by: 'owner', via, why: 'w', rule: null, next: { stage: null, step: null }, done: accepted }])
  const prompt = asEvents([{ type: 'work_trace', session_id: 's1', work_item_id: 'wi_1', stage: 2, step: 1, hook: 'UserPromptSubmit', prompt: 'p' }])
  const corrections = (events: DrillmasterEvent[]) => measureDeliveredItems([...base, ...events, ...delivered])[0]!.values.owner_friction_per_item

  it('counts every chat prompt, and every rejected Owner gate', () => {
    expect(corrections(verdict(true, 'question'))).toBe(0)
    expect(corrections(verdict(false, 'question'))).toBe(1)
    expect(corrections([...prompt, ...verdict(true, 'question')])).toBe(1)
    expect(corrections([...prompt, ...verdict(false, 'question')])).toBe(2)
  })
})
