import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { steppingClock, sequentialIds } from '../src/adapters/clocks.js'
import { ScriptedReviewer } from '../src/adapters/reviewers.js'
import { MemoryArtifactStore } from '../src/adapters/artifacts.js'
import { MemoryStore } from '../src/adapters/stores.js'
import { askUserQuestionInput, pendingOwnerQuestions } from '../src/core/questions.js'
import type { ProjectState } from '../src/core/state.js'
import { migrateWorkflow, type WorkflowDocument } from '../src/core/workflow.js'
import { FolderResolver, folderKey } from '../src/adapters/projects.js'
import type { Ports } from '../src/ports.js'

/** Deterministic ports: memory store, fixed clock, sequential ids, scripted reviewer. */
export function testPorts(script: Record<string, unknown[]> = {}): Ports & { reviewer: ScriptedReviewer } {
  return {
    store: new MemoryStore(),
    artifacts: new MemoryArtifactStore(),
    clock: steppingClock('2026-11-09T10:00:00Z'),
    ids: sequentialIds(),
    reviewer: new ScriptedReviewer(script),
    projects: new FolderResolver(),
  }
}

export const TEST_REPOSITORY = 'git@example.com:owner/drillmaster.git'

export async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `drillmaster-${prefix}-`))
  // Windows can hold a folder a moment after a child process leaves it: retry, never fail a test.
  return { dir, remove: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {}) }
}

const WORK_TOOLS: Record<string, string> = { start: 'work_start', report: 'work_report', gate: 'work_gate', deliver: 'work_deliver', post_mortem: 'work_post_mortem' }

/** Test shorthand: { action, ...fields } becomes the work tool for that action, with the fields every call of it needs. */
export function workToolCall(name: string, args: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
  if (name !== 'work_report' || typeof args.action !== 'string') return { name, arguments: args }
  const { action, ...fields } = args
  const required = action === 'start' ? { description: 'the work item under test' } : action === 'deliver' ? { summary: 'delivered under test' } : {}
  return { name: WORK_TOOLS[action] ?? `work_${action}`, arguments: { ...required, ...fields } }
}

export const OBJECTIVE = { text: 'ship features without Owner stepping in', measures: ['owner_corrections_per_item'] }

/** Two work stages: build (two self gates) and review (an Owner gate). */
export const WORKFLOW_3: WorkflowDocument = migrateWorkflow({
  version: '3.0.0',
  objective: { text: OBJECTIVE.text, measures: ['owner_corrections_per_item'] },
  stages: [
    {
      n: 1,
      name: 'build',
      purpose: 'the change works and is described',
      steps: [
        { n: 1, name: 'run the tests', instruction: 'Run npm test and fix what is red.', gate: 'self', rules: ['test 1.1'], report: ['test result'] },
        { n: 2, name: 'say what the pull request changes', instruction: 'Write the PR description.', gate: 'self', rules: ['pr 1.1'], report: ['what the PR changes'] },
      ],
    },
    {
      n: 2,
      name: 'review',
      purpose: 'Owner accepts the change',
      steps: [{ n: 1, name: 'Owner approves', instruction: 'Ask Owner to review the PR.', gate: 'owner', rules: ['pr 1.1'], report: ['PR link'] }],
    },
  ],
  policies: [
    { name: 'test', rules: [{ id: '1.1', rule: 'the tests run green before a PR', verified_by: 'the test output' }] },
    { name: 'pr', rules: [{ id: '1.1', rule: 'the PR says what it changes', verified_by: 'reading the PR description' }] },
  ],
  metrics: [],
  experiments: [],
})

/** WORKFLOW_3 with work step 1.2 judged by Drillmaster instead of Agent. */
export const WORKFLOW_DM: WorkflowDocument = {
  ...WORKFLOW_3,
  version: '1.0.0',
  stages: WORKFLOW_3.stages.map((stage) =>
    stage.n === 1 ? { ...stage, steps: stage.steps.map((s) => (s.n === 2 ? { ...s, gate: 'drillmaster' as const } : s)) } : stage,
  ),
}

/** Seeds a project's events directly, as if earlier workflow retrospectives had happened. */
export async function seedWorkflow(ports: Ports, dir: string, workflow: WorkflowDocument) {
  const project = folderKey(dir)
  const v0 = { version: '0.0.0', objective: workflow.objective, stages: [], policies: [], metrics: [], experiments: [] }
  await ports.store.append(project, { id: 'seed_0', at: '2026-11-01T00:00:00Z', type: 'project_initialized', dir, workflow: v0 })
  const major = Number(workflow.version.split('.')[0])
  for (let v = 1; v <= major; v++) {
    const doc = v === major ? workflow : { ...v0, version: `${v}.0.0` }
    await ports.store.append(project, { id: `seed_${v}`, at: '2026-11-01T00:00:00Z', type: 'workflow_changed', workflow: doc, reason: 'seeded' })
  }
}

export const EXPERIMENT_1 = {
  id: 1,
  change: 'add pr 1.1',
  purpose: 'Owner corrected missing PR descriptions',
  hypothesis: 'A PR rule stops the corrections',
  null_hypothesis: 'The rule makes no difference',
  measure: 'owner_corrections_per_item' as const,
  baseline: 2,
  baseline_sd: 0.5,
  target: 0.5,
  judge_after: 3,
  version: '2.0.0',
  started: '2026-11-09',
}

/** A workflow after a few retrospectives: one work stage, one work policy, one experiment. */
export const WORKFLOW_2: WorkflowDocument = migrateWorkflow({
  version: '2.0.0',
  objective: { text: OBJECTIVE.text, measures: ['owner_corrections_per_item'] },
  stages: [
    {
      n: 1,
      name: 'build',
      purpose: 'the change works and is described',
      steps: [
        { n: 1, name: 'run the tests', instruction: 'Run npm test.', gate: 'self', rules: [], report: ['test result'] },
        { n: 2, name: 'say what the pull request changes', instruction: 'Write the PR description.', gate: 'owner', rules: ['pr 1.1'], report: ['what the PR changes'] },
      ],
    },
  ],
  policies: [{ name: 'pr', rules: [{ id: '1.1', rule: 'the PR says what it changes', verified_by: 'reading the PR description' }] }],
  metrics: [],
  experiments: [EXPERIMENT_1],
})

let askedOwnerCalls = 0

/**
 * Owner answers in AskUserQuestion, as Claude Code reports it to the hooks. `answerFor` gives the
 * answer to each pending question it wants to answer: an option's label, or text Owner typed.
 */
export async function ownerAnswers(
  app: { state(dir: string): Promise<ProjectState>; hook(dir: string, hookEvent: string, payload: unknown): Promise<{ output?: unknown }> },
  dir: string,
  answerFor: (question: string) => string | { answer: string; notes: string } | undefined,
  sessionId = 's1',
) {
  const asked = pendingOwnerQuestions(await app.state(dir)).filter((question) => answerFor(question.question) !== undefined)
  const toolUseId = `ask_${++askedOwnerCalls}`
  const input = askUserQuestionInput(asked)
  await app.hook(dir, 'PreToolUse', { session_id: sessionId, tool_name: 'AskUserQuestion', tool_use_id: toolUseId, tool_input: input })
  const answers: Record<string, string> = {}
  const annotations: Record<string, { notes: string }> = {}
  for (const question of asked) {
    const answer = answerFor(question.question)!
    answers[question.question] = typeof answer === 'string' ? answer : answer.answer
    if (typeof answer !== 'string') annotations[question.question] = { notes: answer.notes }
  }
  const outcome = await app.hook(dir, 'PostToolUse', { session_id: sessionId, tool_name: 'AskUserQuestion', tool_use_id: toolUseId, tool_input: input, tool_response: { answers, annotations } })
  return (outcome.output as { hookSpecificOutput?: { additionalContext?: string } } | undefined)?.hookSpecificOutput?.additionalContext ?? ''
}
