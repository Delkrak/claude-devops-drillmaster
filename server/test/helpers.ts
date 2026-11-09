import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fixedClock, sequentialIds } from '../src/adapters/clocks.js'
import { ScriptedReviewer } from '../src/adapters/reviewers.js'
import { MemoryStore } from '../src/adapters/stores.js'
import type { WorkflowDocument } from '../src/core/workflow.js'
import type { Ports } from '../src/ports.js'

/** Deterministic ports: memory store, fixed clock, sequential ids, scripted reviewer. */
export function testPorts(script: Record<string, unknown[]> = {}): Ports & { reviewer: ScriptedReviewer } {
  return {
    store: new MemoryStore(),
    clock: fixedClock('2026-11-09T10:00:00Z'),
    ids: sequentialIds(),
    reviewer: new ScriptedReviewer(script),
  }
}

export async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `drillmaster-${prefix}-`))
  // Windows can hold a folder a moment after a child process leaves it: retry, never fail a test.
  return { dir, remove: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {}) }
}

export const OBJECTIVE = { text: 'ship features without Owner stepping in', measures: ['owner_corrections_per_item'] }

/** Two work stages: build (two self gates) and review (an Owner gate). */
export const WORKFLOW_3: WorkflowDocument = {
  version: 3,
  objective: { text: OBJECTIVE.text, measures: ['owner_corrections_per_item'] },
  stages: [
    {
      n: 1,
      name: 'build',
      steps: [
        { n: 1, name: 'run the tests', gate: 'self', rules: ['test 1.1'], report: ['test result'] },
        { n: 2, name: 'say what the pull request changes', gate: 'self', rules: ['pr 1.1'], report: ['what the PR changes'] },
      ],
    },
    { n: 2, name: 'review', steps: [{ n: 1, name: 'Owner approves', gate: 'owner', rules: ['pr 1.1'], report: ['PR link'] }] },
  ],
  policies: [
    { name: 'test', rules: [{ id: '1.1', rule: 'the tests run green before a PR', verified_by: 'the test output' }] },
    { name: 'pr', rules: [{ id: '1.1', rule: 'the PR says what it changes', verified_by: 'reading the PR description' }] },
  ],
  experiments: [],
}

/** WORKFLOW_3 with work step 1.2 judged by Drillmaster instead of Agent. */
export const WORKFLOW_DM: WorkflowDocument = {
  ...WORKFLOW_3,
  version: 1,
  stages: WORKFLOW_3.stages.map((stage) =>
    stage.n === 1 ? { ...stage, steps: stage.steps.map((s) => (s.n === 2 ? { ...s, gate: 'drillmaster' as const } : s)) } : stage,
  ),
}

/** Seeds a project's events directly, as if earlier workflow retrospectives had happened. */
export async function seedWorkflow(ports: Ports, dir: string, workflow: WorkflowDocument) {
  const { projectId } = await import('../src/env.js')
  const project = projectId(dir)
  const v0 = { version: 0, objective: workflow.objective, stages: [], policies: [], experiments: [] }
  await ports.store.append(project, { id: 'seed_0', at: '2026-11-01T00:00:00Z', type: 'project_initialized', dir, workflow: v0 })
  for (let v = 1; v <= workflow.version; v++) {
    const doc = v === workflow.version ? workflow : { ...v0, version: v }
    await ports.store.append(project, { id: `seed_${v}`, at: '2026-11-01T00:00:00Z', type: 'workflow_changed', workflow: doc, reason: 'seeded' })
  }
}

/** A workflow after a few retrospectives: one work stage, one work policy, one experiment. */
export const WORKFLOW_2: WorkflowDocument = {
  version: 2,
  objective: { text: OBJECTIVE.text, measures: ['owner_corrections_per_item'] },
  stages: [
    {
      n: 1,
      name: 'build',
      steps: [
        { n: 1, name: 'run the tests', gate: 'self', rules: [], report: ['test result'] },
        { n: 2, name: 'say what the pull request changes', gate: 'owner', rules: ['pr 1.1'], report: ['what the PR changes'] },
      ],
    },
  ],
  policies: [{ name: 'pr', rules: [{ id: '1.1', rule: 'the PR says what it changes', verified_by: 'reading the PR description' }] }],
  experiments: [
    { id: 1, change: 'add pr 1.1', purpose: 'Owner corrected missing PR descriptions', measure: 'owner_corrections_per_item', baseline: 2, started: '2026-11-09' },
  ],
}
