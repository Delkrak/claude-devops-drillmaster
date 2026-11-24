import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readArtifactFromWorkFolder } from '../../src/adapters/artifacts.js'
import type { DrillmasterEvent, StepSkipRequested } from '../../src/core/events.js'
import { judgeExperiment } from '../../src/core/experiments.js'
import type { ItemMeasures } from '../../src/core/measures.js'
import { renderSessionOutline } from '../../src/core/render.js'
import { applyProposal, buildPostMortemPrompt, readRetroAnswer } from '../../src/core/retro.js'
import { buildSkipPrompt } from '../../src/core/review.js'
import { foldState } from '../../src/core/state.js'
import { EXPERIMENT_1, WORKFLOW_2, WORKFLOW_3 } from '../helpers.js'

const [testsStep, prStep] = WORKFLOW_3.stages[0]!.steps
const item = (n: number, friction: number, passed: string[], rejections: Record<string, number> = {}): ItemMeasures => ({
  work_item_id: `wi_${n}`,
  issue: `#${n}`,
  workflow_version: '2.0.0',
  delivered_at: `2026-11-1${n}T10:00:00Z`,
  inputs: {},
  passed_step_guids: passed,
  rejections_by_rule: rejections,
  values: { owner_friction_per_item: friction, gate_rejections_per_item: Object.values(rejections).reduce((sum, count) => sum + count, 0), review_rounds_per_item: 0, minutes_per_item: 1, tool_calls_per_item: 1 },
})

describe('an experiment counts only the work items that went through what its change touched', () => {
  const experiment = { ...EXPERIMENT_1, judge_after: 2, affects: [prStep!.guid] }

  it('leaves out work items that did not go through the changed step, and counts rejections citing its rules', () => {
    const items = [item(1, 0, [testsStep!.guid]), item(2, 0, [testsStep!.guid, prStep!.guid], { 'pr 1.1': 1 }), item(3, 0, [prStep!.guid])]
    const verdict = judgeExperiment(experiment, items, [], WORKFLOW_3)
    expect(verdict).toMatchObject({ counted: 2, through_steps: ['1.2'], rule_rejections: { 'pr 1.1': 1 }, status: 'keep' })
    expect(judgeExperiment({ ...experiment, affects: undefined }, items, [], WORKFLOW_3).counted).toBe(3)
  })

  it('tells the post mortem which number a work item is for each experiment', () => {
    const workflow = { ...WORKFLOW_3, experiments: [experiment] }
    const at = (n: number) => `2026-11-12T10:0${n}:00Z`
    const events = [
      { id: 'e0', at: at(0), type: 'project_initialized', dir: '/p', workflow },
      ...[1, 2].flatMap((n) => [
        { id: `s${n}`, at: at(n), type: 'work_item_started', work_item_id: `wi_${n}`, issue: `#${n}`, workflow_version: workflow.version, token_hash: `h${n}`, stage: 1, step: 1 },
        { id: `v${n}`, at: at(n), type: 'gate_verdict', work_item_id: `wi_${n}`, stage: 1, step: 2, step_guid: n === 2 ? prStep!.guid : testsStep!.guid, accepted: true, by: 'agent', why: 'ok', rule: null, next: { stage: null, step: null }, done: true },
        { id: `d${n}`, at: at(n), type: 'work_item_delivered', work_item_id: `wi_${n}`, pr: 'local' },
      ]),
    ] as DrillmasterEvent[]
    const state = foldState(events)
    expect(buildPostMortemPrompt(state.workItems.wi_1!, workflow, events)).toContain('this work item does not count for it: it did not go through the steps the change touched.')
    expect(buildPostMortemPrompt(state.workItems.wi_2!, workflow, events)).toContain(`- experiment 1 "${EXPERIMENT_1.change}", judged after 2 work items: this work item is number 1 of them.`)
  })
})

describe('a proposal that could never show an improvement', () => {
  const answer = (measure: string, target?: number) => ({
    findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] },
    proposals: [{ change: 'add a step', purpose: 'p', measure, ...(target === undefined ? {} : { target }), ops: [{ op: 'change_step', step: '1.1', instruction: 'Run the tests twice.' }] }],
  })

  it('is dropped when its measure is 0 already, or its target is not below the baseline', () => {
    const delivered = [item(1, 0, []), item(2, 0, [])]
    expect(readRetroAnswer(WORKFLOW_2, answer('gate_rejections_per_item'), [], delivered).dropped).toEqual([
      { change: 'add a step', error: 'It is judged on gate_rejections_per_item, which is 0 over the last 2 delivered work items, so it cannot show an improvement. Judge it on a measure that can still drop.' },
    ])
    expect(readRetroAnswer(WORKFLOW_2, answer('minutes_per_item', 1), [], delivered).dropped[0]!.error).toBe('Its target 1 on minutes_per_item is not below the baseline 1, so meeting it shows no improvement.')
    const fiveJudged = [1, 2, 3, 4, 5].map((n) => item(n, n % 2 ? 2 : 1, []))
    expect(readRetroAnswer(WORKFLOW_2, answer('owner_corrections_per_item', 0), [], fiveJudged).proposals[0]).toMatchObject({ measure: 'owner_friction_per_item' })
  })

  it('is kept on a judged measure with fewer than five judged work items, its baseline saying how many', () => {
    const oneJudged = [item(1, 2, [])]
    const read = readRetroAnswer(WORKFLOW_2, answer('owner_friction_per_item', 0), [], oneJudged)
    expect(read.dropped).toEqual([])
    expect(applyProposal(WORKFLOW_2, read.proposals[0]!, oneJudged, '2026-11-24').workflow.experiments.at(-1)).toMatchObject({ measure: 'owner_friction_per_item', baseline: 2, baseline_items: 1 })
  })

  it('is dropped on a judged measure no delivered work item was judged on', () => {
    const unjudged = [{ ...item(1, 2, []), values: { gate_rejections_per_item: 0, review_rounds_per_item: 0, minutes_per_item: 1, tool_calls_per_item: 1 } }]
    expect(readRetroAnswer(WORKFLOW_2, answer('owner_friction_per_item', 0), [], unjudged).dropped).toEqual([
      { change: 'add a step', error: 'It is judged on owner_friction_per_item, which Drillmaster has not judged on any delivered work item yet, so there is nothing to improve on. Judge it on another measure, or wait for a work item judged on it.' },
    ])
  })
})

describe("the session's work stages, in outline", () => {
  it('lists every step of the stages the session works on, with its gate, if and who skips it', () => {
    const workflow = structuredClone(WORKFLOW_3)
    workflow.stages[1]!.steps[0]!.skippable = 'owner'
    workflow.stages[0]!.steps[1]!.if = "kind == 'feature'"
    expect(renderSessionOutline(workflow, null, { stage: 1, step: 2 })).toBe(
      [
        "**This session's work stages** (each step's instruction comes when you reach it):",
        '- Stage 1 "build"',
        '  - 1.1 run the tests (self gate)',
        "  - 1.2 say what the pull request changes (self gate, only when kind == 'feature') <- you are here",
        '- Stage 2 "review"',
        '  - 2.1 Owner approves (Owner gate, skippable (Owner decides))',
      ].join('\n'),
    )
    expect(renderSessionOutline(workflow, [workflow.stages[1]!.guid], { stage: 2, step: 1 })).not.toContain('Stage 1')
  })
})

describe('a skip Drillmaster judges', () => {
  it('is checked claim by claim against the traces, with no approval on a condition', () => {
    const request = { id: 'r', at: 'x', type: 'step_skip_requested', work_item_id: 'wi_1', stage: 1, step: 1, decided_by: 'drillmaster', why: 'CHANGES.md is updated' } as StepSkipRequested
    const prompt = buildSkipPrompt(WORKFLOW_3, { work_item_id: 'wi_1', issue: '#1', description: 'd' } as never, request, [])
    expect(prompt).toContain('Reject a skip whose claim has nothing behind it in the traces, and say which claim.')
    expect(prompt).toContain('There is no approval with a condition')
  })
})

describe('artifacts', () => {
  it('include source, test and diff files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'drillmaster-source-artifacts-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      await writeFile(path.join(dir, 'csv.js'), 'export const toCsv = () => ""')
      await writeFile(path.join(dir, 'change.diff'), '+ one line')
      expect(await readArtifactFromWorkFolder(dir, 'csv.js')).toMatchObject({ mediaType: 'text/plain' })
      expect(await readArtifactFromWorkFolder(dir, 'change.diff')).toMatchObject({ mediaType: 'text/x-diff' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
