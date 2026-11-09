import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { classifyOwner, handleHook } from '../../src/core/hooks.js'
import { foldState } from '../../src/core/state.js'
import { WORKFLOW_DM } from '../helpers.js'

describe("classifying Owner's words", () => {
  it.each([
    ['looks good, ship it', 'approve'],
    ['Yes', 'approve'],
    ['LGTM', 'approve'],
    ['approved', 'approve'],
    ['ja, godkendt', 'approve'],
    ['no, the PR needs a description', 'reject'],
    ['looks good but fix the typo first', 'reject'],
    ['not yet', 'reject'],
    ['what does this do?', 'unclear'],
    ['hmm', 'unclear'],
  ])('%s -> %s', (prompt, expected) => {
    expect(classifyOwner(prompt)).toBe(expected)
  })
})

const at = '2026-11-09T10:00:00Z'
const base: DrillmasterEvent[] = [
  { id: 'e0', at, type: 'project_initialized', dir: '/p', workflow: WORKFLOW_DM },
  { id: 's', at, type: 'work_item_started', work_item_id: 'wi_1', issue: '#7', workflow_version: 0, token_hash: 'h', stage: 2, step: 1 },
  { id: 'r', at, type: 'session_registered', session_id: 's1', source: 'startup' },
  { id: 'b', at, type: 'session_bound', session_id: 's1', work_item_id: 'wi_1' },
  { id: 'g', at, type: 'gate_submitted', work_item_id: 'wi_1', stage: 2, step: 1, gate: 'owner', self_check: [], text: 'PR #40' },
]

describe('the Owner gate in the UserPromptSubmit hook', () => {
  it("records Owner's approval as the verdict, and tells Agent", () => {
    const outcome = handleHook(foldState(base), 'UserPromptSubmit', { session_id: 's1', prompt: 'looks good' }, false)
    expect(outcome.events.at(-1)).toMatchObject({
      type: 'gate_verdict',
      accepted: true,
      by: 'owner',
      why: 'Owner: "looks good"',
      rule: 'pr 1.1',
      next: { stage: null, step: null },
      done: true,
    })
    expect((outcome.output as any).hookSpecificOutput.additionalContext).toMatch(/Owner approved.*deliver/)
  })

  it('sends the work back on a rejection', () => {
    const outcome = handleHook(foldState(base), 'UserPromptSubmit', { session_id: 's1', prompt: 'no, add a description' }, false)
    expect(outcome.events.at(-1)).toMatchObject({ type: 'gate_verdict', accepted: false, next: { stage: 2, step: 1 } })
  })

  it('leaves the gate pending on unclear words, and only listens to the bound session', () => {
    expect(handleHook(foldState(base), 'UserPromptSubmit', { session_id: 's1', prompt: 'what changed?' }, false).events.map((e) => e.type)).toEqual(['work_trace'])
    const other = handleHook(foldState(base), 'UserPromptSubmit', { session_id: 's2', prompt: 'yes' }, false)
    expect(other.events.map((e) => e.type)).toEqual(['session_registered', 'work_trace'])
  })
})
