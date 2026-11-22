import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { judgeExperiment } from '../../src/core/experiments.js'
import { handleHook } from '../../src/core/hooks.js'
import { InvalidPipeline, parsePipeline, runPipeline } from '../../src/core/logPipeline.js'
import type { ItemMeasures } from '../../src/core/measures.js'
import { askUserQuestionInput, pendingOwnerQuestions } from '../../src/core/questions.js'
import { foldState } from '../../src/core/state.js'
import { migrateWorkflow } from '../../src/core/workflow.js'
import { EXPERIMENT_1, WORKFLOW_3 } from '../helpers.js'

describe('the LogQL subset, at its edges', () => {
  it('leaves a named group that took no part in the match out of the fields', () => {
    expect(runPipeline(parsePipeline('| regexp `(?:(?P<failed>\\d+) failed, )?(?P<passed>\\d+) passed`'), 'Tests 5 passed')[0]!.fields).toEqual({ passed: '5' })
  })

  it('refuses a pattern that names a capture twice, as an invalid pipeline', () => {
    expect(() => parsePipeline('| pattern "<n> passed <n> failed"')).toThrow(InvalidPipeline)
  })

  it('reads an array element in a json path', () => {
    expect(runPipeline(parsePipeline('| json first="testResults[0].status"'), '{"testResults":[{"status":"failed"}]}')[0]!.fields).toEqual({ first: 'failed' })
  })
})

describe('an experiment whose measure was defined differently when it started', () => {
  const item = (n: number, version: string, friction: number): ItemMeasures => ({
    work_item_id: `wi_${n}`,
    issue: `#${n}`,
    workflow_version: version,
    delivered_at: `2026-11-1${n}T10:00:00Z`,
    inputs: {},
    passed_step_guids: [],
    rejections_by_rule: {},
    values: { owner_friction_per_item: friction, gate_rejections_per_item: 0, review_rounds_per_item: 0, minutes_per_item: 1, tool_calls_per_item: 1 },
  })

  it('is read with a fresh baseline from the items before it, by the measure as it is now', () => {
    const migrated = migrateWorkflow({ ...WORKFLOW_3, experiments: [{ ...EXPERIMENT_1, measure: 'owner_corrections_per_item', baseline: 3, baseline_sd: 0.5, version: '3.0.0' }] })
    const experiment = migrated.experiments[0]!
    expect(experiment).toMatchObject({ measure: 'owner_friction_per_item', rebaseline: true })
    const items = [item(1, '2.0.0', 1), item(2, '2.0.0', 1), item(3, '3.0.0', 1), item(4, '3.0.0', 1), item(5, '3.0.0', 1)]
    expect(judgeExperiment(experiment, items)).toMatchObject({ baseline: 1, baseline_sd: 0, null_rejected: false, status: 'rethink' })
  })
})

describe("Agent's own questions to Owner", () => {
  it("pass with the header of another work item's pending question", () => {
    const at = '2026-11-12T10:00:00Z'
    const withInput = migrateWorkflow({ ...WORKFLOW_3, inputs: [{ name: 'size', options: [{ value: 's', description: 's' }, { value: 'l', description: 'l' }], set_at: 'start', by: 'owner', instruction: 'How big?' }] })
    const events = [
      { id: 'i', at, type: 'project_initialized', dir: '/p', workflow: withInput },
      { id: 'a', at, type: 'work_item_started', work_item_id: 'wi_a', issue: '#1', workflow_version: '3.0.0', token_hash: 'a', stage: 1, step: 1 },
      { id: 'b', at, type: 'work_item_started', work_item_id: 'wi_b', issue: '#2', workflow_version: '3.0.0', token_hash: 'b', stage: 1, step: 1 },
      { id: 'r', at, type: 'session_registered', session_id: 's_b', source: 'startup' },
      { id: 'sb', at, type: 'session_bound', session_id: 's_b', work_item_id: 'wi_b' },
    ] as DrillmasterEvent[]
    const own = { question: 'Which thumbnail size?', header: 'size', options: [{ label: 'small', description: '64px' }, { label: 'large', description: '256px' }], multiSelect: false }
    const ask = (questions: unknown[]) => handleHook(foldState(events), 'PreToolUse', { session_id: 's_b', tool_name: 'AskUserQuestion', tool_use_id: 't', tool_input: { questions } }, false)
    // wi_b's own input question has the header "size" too, so asking that header in another form is blocked; wi_a's is not this session's.
    expect(ask([own]).output).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } })
    const onlyA = events.filter((event) => event.id !== 'b')
    expect(handleHook(foldState(onlyA), 'PreToolUse', { session_id: 's_b', tool_name: 'AskUserQuestion', tool_use_id: 't', tool_input: { questions: [own] } }, false).output).toBeUndefined()
    const pending = askUserQuestionInput(pendingOwnerQuestions(foldState(events)).filter((question) => 'work_item_id' in question && question.work_item_id === 'wi_b'))
    expect(ask(pending.questions).output).toBeUndefined()
  })
})
