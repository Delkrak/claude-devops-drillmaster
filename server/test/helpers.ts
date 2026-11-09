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
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) }
}

export const OBJECTIVE = { text: 'ship features without Owner stepping in', measures: ['owner_corrections_per_item'] }

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
