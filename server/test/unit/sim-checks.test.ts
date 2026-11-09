import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { workflowZero } from '../../src/core/workflow.js'
import { checkRun } from '../sim/assertions.js'
import { EXPERIMENT_1, OBJECTIVE } from '../helpers.js'

const at = (m: number) => `2026-11-09T10:${String(m).padStart(2, '0')}:00.000Z`
const item = (n: number, m: number, corrections: number): DrillmasterEvent[] => [
  { id: `s${n}`, at: at(m), type: 'work_item_started', work_item_id: `wi_${n}`, issue: `#${n}`, workflow_version: '0.0.0', token_hash: `h${n}`, stage: null, step: null },
  { id: `b${n}`, at: at(m), type: 'session_bound', session_id: 'S', work_item_id: `wi_${n}` },
  ...Array.from({ length: corrections }, (_, i): DrillmasterEvent => ({ id: `p${n}${i}`, at: at(m + 1), type: 'work_trace', session_id: 'S', work_item_id: `wi_${n}`, stage: null, step: null, hook: 'UserPromptSubmit', prompt: 'fix it' })),
  { id: `t${n}`, at: at(m + 1), type: 'work_trace', session_id: 'S', work_item_id: `wi_${n}`, stage: null, step: null, hook: 'PostToolUse', tool: 'Bash', input: '{"token":"[redacted]"}' },
  { id: `d${n}`, at: at(m + 2), type: 'work_item_delivered', work_item_id: `wi_${n}`, pr: 'local' },
  { id: `ma${n}`, at: at(m + 2), type: 'post_mortem_written', work_item_id: `wi_${n}`, author: 'agent', keep: 'k', change: 'c', experiment_reflections: 'e', free_text: '' },
  { id: `md${n}`, at: at(m + 2), type: 'post_mortem_written', work_item_id: `wi_${n}`, author: 'drillmaster', keep: 'k', change: 'c', experiment_reflections: 'e', free_text: '' },
]
const w0 = workflowZero(OBJECTIVE as never)
const w1 = { ...w0, version: '1.0.0', experiments: [{ ...EXPERIMENT_1, version: '1.0.0' }] }
const events: DrillmasterEvent[] = [
  { id: 'i', at: at(0), type: 'project_initialized', dir: '/p', workflow: w0 },
  ...item(1, 1, 2),
  { id: 'r', at: at(10), type: 'retrospective_ran', retro_id: 'retro_1', work_items: ['wi_1'], findings: { should: '', did: '', why: '', keep: '', improve: '' }, proposals: [] },
  { id: 'c', at: at(11), type: 'workflow_changed', workflow: w1, reason: 'c' },
  ...item(2, 20, 0),
]

describe('simulation run checks', () => {
  it('passes a run that shows the whole loop', () => {
    const { checks, metrics } = checkRun(events, { ownerMessages: 2, issues: 2, retros: 1 })
    expect(checks.filter((c) => !c.ok)).toEqual([])
    expect(metrics).toMatchObject({ corrections_before: 2, corrections_after: 0, workflow_version: '1.0.0' })
  })

  it('fails a run with a leaked token or a missing post mortem', () => {
    const leaked: DrillmasterEvent[] = [...events, { id: 'x', at: at(30), type: 'work_trace', session_id: 'S', work_item_id: 'wi_2', stage: null, step: null, hook: 'PreToolUse', input: '{"token":"abcdefghijklmnopqrstuvwx"}' }]
    expect(checkRun(leaked, { ownerMessages: 2, issues: 2, retros: 1 }).checks.find((c) => c.name.includes('token'))!.ok).toBe(false)
    const missing = events.filter((e) => e.id !== 'md2')
    expect(checkRun(missing, { ownerMessages: 2, issues: 2, retros: 1 }).checks.find((c) => c.name.includes('post mortems'))!.ok).toBe(false)
  })
})
