import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { buildFrictionPrompt, readFrictionAnswer } from '../../src/core/friction.js'
import { measureDeliveredItems } from '../../src/core/measures.js'
import { ownerInputsOf } from '../../src/core/ownerInputs.js'
import { WORKFLOW_3 } from '../helpers.js'

const at = (n: number) => `2026-11-09T10:${String(n).padStart(2, '0')}:00Z`
let clock = 0
const event = (fields: Record<string, unknown>) => ({ id: `e${clock}`, at: at(clock++), ...fields }) as DrillmasterEvent
const prompt = (text: string, workItemId: string | null) => event({ type: 'work_trace', session_id: 's1', work_item_id: workItemId, stage: null, step: null, hook: 'UserPromptSubmit', prompt: text })
const tool = (name: string, workItemId: string | null) => event({ type: 'work_trace', session_id: 's1', work_item_id: workItemId, stage: null, step: null, hook: 'PostToolUse', tool: name })
const start = (workItemId: string, issue: string) => [
  tool('mcp__plugin_devops-drillmaster_drillmaster__work_start', null),
  event({ type: 'work_item_started', work_item_id: workItemId, issue, workflow_version: '3.0.0', token_hash: workItemId, stage: 1, step: 1 }),
  event({ type: 'session_bound', session_id: 's1', work_item_id: workItemId }),
]
const deliver = (workItemId: string) => event({ type: 'work_item_delivered', work_item_id: workItemId, pr: 'local' })

/** One session: #1 started and delivered, a fix after delivery, #2 started on the same session, then a retrospective. */
function session() {
  clock = 0
  return [
    event({ type: 'project_initialized', dir: '/p', workflow: WORKFLOW_3 }),
    prompt('do issue #1', null),
    tool('Read', null),
    ...start('wi_1', '#1'),
    tool('Edit', 'wi_1'),
    deliver('wi_1'),
    prompt('you forgot the CHANGES.md line', 'wi_1'),
    tool('Edit', 'wi_1'),
    prompt('now do issue #2', 'wi_1'),
    ...start('wi_2', '#2'),
    prompt('keep it short', 'wi_2'),
    tool('Bash', 'wi_2'),
    deliver('wi_2'),
    prompt('thanks, that was it', 'wi_2'),
    prompt("let's do a retrospective", 'wi_2'),
    tool('mcp__plugin_devops-drillmaster_drillmaster__workflow_retrospective', 'wi_2'),
  ]
}

describe("Owner's inputs, each where it belongs", () => {
  it('gives the input that starts a work item to that one, not to the one the session was on', () => {
    expect(ownerInputsOf(session()).map(({ prompt: text, role, work_item_id: workItemId, after_delivery: afterDelivery }) => [text, role, workItemId, afterDelivery])).toEqual([
      ['do issue #1', 'start', 'wi_1', false],
      ['you forgot the CHANGES.md line', 'input', 'wi_1', true],
      ['now do issue #2', 'start', 'wi_2', false],
      ['keep it short', 'input', 'wi_2', false],
      ['thanks, that was it', 'input', 'wi_2', true],
      ["let's do a retrospective", 'retrospective', null, false],
    ])
  })

  it("counts friction as the judge decided, and until then by what an input led to", () => {
    const events = session()
    const unjudged = measureDeliveredItems(events)
    // wi_1: the fix after delivery, which Agent then made. wi_2: the input during the work; the thanks changed nothing.
    expect(unjudged.map((item) => item.values.owner_friction_per_item)).toEqual([1, 1])
    const inputs = ownerInputsOf(events)
    const judged = measureDeliveredItems([
      ...events,
      event({ type: 'owner_inputs_judged', work_item_id: 'wi_2', inputs: [{ event: inputs[3]!.event_id, friction: false, why: 'a wish, not a correction' }] }),
    ])
    expect(judged.map((item) => item.values.owner_friction_per_item)).toEqual([1, 0])
  })
})

describe('the friction judge', () => {
  it('sees the work item, the inputs and what Agent did around them, and nothing of the workflow', () => {
    const events = session()
    const inputs = ownerInputsOf(events).filter((input) => input.work_item_id === 'wi_1')
    const judgePrompt = buildFrictionPrompt({ work_item_id: 'wi_1', issue: '#1', description: 'CSV export' }, inputs, events)
    expect(judgePrompt).toContain('Work item wi_1 (#1): CSV export')
    expect(judgePrompt).toContain(`- ${inputs[0]!.event_id} (it started the work item): "do issue #1"`)
    expect(judgePrompt).toContain(`- ${inputs[1]!.event_id} (it came while Agent worked on the work item, after delivery): "you forgot the CHANGES.md line"`)
    expect(judgePrompt).toContain('    - Edit')
    expect(judgePrompt).not.toContain('workflow 3.0.0')
    expect(judgePrompt).not.toContain('pr 1.1')
  })

  it('keeps only judgements of the inputs it was asked about', () => {
    const inputs = ownerInputsOf(session()).slice(0, 2)
    const answer = { inputs: [{ event: inputs[1]!.event_id, friction: true, why: 'Owner had to remind Agent' }, { event: 'e999', friction: true, why: 'x' }, { event: inputs[0]!.event_id, friction: 'no' }] }
    expect(readFrictionAnswer(inputs, answer)).toEqual([{ event: inputs[1]!.event_id, friction: true, why: 'Owner had to remind Agent' }])
  })
})
