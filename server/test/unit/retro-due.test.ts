import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { handleHook } from '../../src/core/hooks.js'
import { buildRetroPrompt, readRetroAnswer, retrospectiveDue } from '../../src/core/retro.js'
import { foldState } from '../../src/core/state.js'
import { workflowZero } from '../../src/core/workflow.js'
import { EXPERIMENT_1, OBJECTIVE, WORKFLOW_2 } from '../helpers.js'

const at = (minute: number) => `2026-11-09T10:${String(minute).padStart(2, '0')}:00.000Z`
const delivered = (n: number, version = '2.0.0'): DrillmasterEvent[] => [
  { id: `s${n}`, at: at(n * 2), type: 'work_item_started', work_item_id: `wi_${n}`, issue: `#${n}`, workflow_version: version, token_hash: `h${n}`, stage: null, step: null },
  { id: `d${n}`, at: at(n * 2 + 1), type: 'work_item_delivered', work_item_id: `wi_${n}`, pr: `#${n}` },
]
const init: DrillmasterEvent = { id: 'i', at: at(0), type: 'project_initialized', dir: '/p', workflow: workflowZero(OBJECTIVE as never) }
const grown: DrillmasterEvent = { id: 'c', at: at(1), type: 'workflow_changed', workflow: WORKFLOW_2, reason: 'retro 1', retro_id: 'retro_1', proposal: 1 }
const retro: DrillmasterEvent = {
  id: 'r',
  at: at(1),
  type: 'retrospective_ran',
  retro_id: 'retro_1',
  work_items: [],
  findings: { should: '', did: '', why: '', keep: [], improve: [] },
  proposals: [
    { id: 1, change: 'add pr 1.1', purpose: 'Owner corrected PR descriptions', hypothesis: 'A PR rule stops the corrections', measure: 'owner_corrections_per_item', ops: [] },
    { id: 2, change: 'time it', purpose: 'see speed', measure: 'minutes_per_item', ops: [] },
  ],
}
const decided: DrillmasterEvent = { id: 'o', at: at(1), type: 'owner_decided', retro_id: 'retro_1', approved: [1], declined: [2], prompt: 'approve 1, decline 2' }

describe('when a retrospective is due', () => {
  it('is not due with too little to judge', () => {
    const events = [init, retro, decided, grown, ...delivered(1)]
    expect(retrospectiveDue(foldState(events), events)).toBeNull()
  })

  it('is due once a running experiment reached its judge_after items', () => {
    const events = [init, retro, decided, grown, ...delivered(1), ...delivered(2), ...delivered(3)]
    expect(retrospectiveDue(foldState(events), events)).toBe(`experiment ${EXPERIMENT_1.id} can be judged: its judge_after items are delivered`)
  })

  it('is due after five delivered items with nothing to judge', () => {
    const events = [init, ...[1, 2, 3, 4, 5].flatMap((n) => delivered(n, '0.0.0'))]
    expect(retrospectiveDue(foldState(events), events)).toBe('5 work items were delivered since the last retrospective')
  })

  it('is said in the SessionStart brief, as a suggestion to Owner', () => {
    const outcome = handleHook(foldState([init]), 'SessionStart', { session_id: 's' }, false, { retrospectiveDue: '5 work items were delivered since the last retrospective' })
    expect((outcome.output as any).hookSpecificOutput.additionalContext).toContain('A workflow retrospective is due: 5 work items were delivered since the last retrospective. Suggest it to Owner')
  })
})

describe('what a retrospective reads', () => {
  it('includes the reports and Owner words of open work items, which phases keep open across retrospectives', () => {
    const open: DrillmasterEvent[] = [
      { id: 'o1', at: at(2), type: 'work_item_started', work_item_id: 'wi_open', issue: '#9', workflow_version: '2.0.0', token_hash: 'h9', stage: 1, step: 1 },
      { id: 'o2', at: at(3), type: 'work_trace', session_id: 's9', work_item_id: 'wi_open', stage: 1, step: 1, hook: 'UserPromptSubmit', prompt: 'tell the stakeholders' },
      { id: 'o3', at: at(4), type: 'work_reported', work_item_id: 'wi_open', stage: 1, step: 1, kind: 'impediment', text: 'stakeholders were not told' },
    ]
    const events = [init, grown, ...open]
    const prompt = buildRetroPrompt(foldState(events), events, [])
    expect(prompt).toContain('Open work items, partly done (their reports and Owner\'s words below count too): wi_open (#9) at step 1.1')
    expect(prompt).toContain('- wi_open: "tell the stakeholders"')
    expect(prompt).toContain('stakeholders were not told')
  })
})

describe("a retrospective's opening", () => {
  it("gives Drillmaster the last retrospective's actions to judge first", () => {
    const events = [init, retro, decided, grown, ...delivered(1)]
    const prompt = buildRetroPrompt(foldState(events), events, [{ name: 'work_deliver', description: 'Delivers. artifacts: images or text, at most 5 MB each.' }])
    expect(prompt).toContain('- work_deliver: Delivers. artifacts: images or text, at most 5 MB each.')
    expect(prompt).toContain("Open by judging the last retrospective's actions")
    expect(prompt).toContain('- proposal 1 "add pr 1.1" (purpose: Owner corrected PR descriptions; hypothesis: A PR rule stops the corrections): applied as workflow 2.0.0')
    expect(prompt).toContain('- proposal 2 "time it" (purpose: see speed): declined by Owner')
  })

  it('reads the opening with the findings', () => {
    const read = readRetroAnswer(WORKFLOW_2, { findings: { opening: 'The PR rule worked.', should: 's', did: 'd', why: 'w', keep: 'k', improve: 'i' }, proposals: [] })
    expect(read.findings.opening).toBe('The PR rule worked.')
    expect(readRetroAnswer(WORKFLOW_2, { findings: { should: 's', did: 'd', why: 'w', keep: 'k', improve: 'i' } }).findings.opening).toBe('')
  })
})
