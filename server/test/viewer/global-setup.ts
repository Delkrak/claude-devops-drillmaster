import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownerAnswers, TEST_REPOSITORY, workToolCall } from '../helpers.js'
import { RUN_VIEWER_PORT, VIEWER_PORT } from './port.js'

const dist = (file: string) => import(pathToFileURL(path.resolve(import.meta.dirname, '../../dist', file)).href)

/** A real folder, so the demo can deliver an image artifact from it. The same path in every process. */
export const DEMO_DIR = path.join(os.tmpdir(), 'dm-viewer-demo', 'gates-demo')
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export default async function setup() {
  const { Drillmaster } = await dist('app.js')
  const { JsonlStore } = await dist('adapters/stores.js')
  const { FileArtifactStore } = await dist('adapters/artifacts.js')
  const { systemClock, sequentialIds } = await dist('adapters/clocks.js')
  const { ScriptedReviewer } = await dist('adapters/reviewers.js')
  const { listen } = await dist('daemon/http.js')
  const { folderKey: projectId, FolderResolver } = await dist('adapters/projects.js')

  const home = mkdtempSync(path.join(os.tmpdir(), 'dm-viewer-'))
  rmSync(DEMO_DIR, { recursive: true, force: true })
  mkdirSync(DEMO_DIR, { recursive: true })
  writeFileSync(path.join(DEMO_DIR, 'after.png'), Buffer.from(PNG_1X1, 'base64'))
  const store = new JsonlStore(path.join(home, 'projects'))

  // The recorded simulation run, as the local event log keeps it.
  const run = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'sim-run.json'), 'utf8')) as { type: string; dir?: string }[]
  const runDir = run.find((e) => e.type === 'project_initialized')!.dir!
  mkdirSync(path.join(home, 'projects', projectId(runDir)), { recursive: true })
  writeFileSync(path.join(home, 'projects', projectId(runDir), 'events.jsonl'), run.map((e) => JSON.stringify(e)).join('\n') + '\n')

  // A synthetic project through the real app.
  const reviewer = new ScriptedReviewer({
    gate: [{ accepted: false, rule: 'pr 1.1', why: 'The PR description does not say what changed.', back_to: { stage: 1, step: 1 } }],
    post_mortem: [{ keep: 'Small PRs', change: 'Ask for CHANGES.md in a rule', experiment_reflections: 'none running', free_text: '' }],
  })
  const app = new Drillmaster({ store, artifacts: new FileArtifactStore(path.join(home, 'projects')), clock: systemClock, ids: sequentialIds(), reviewer, projects: new FolderResolver() })
  await app.callTool(DEMO_DIR, 'workflow_retrospective', { action: 'setup', drillmaster_repository: TEST_REPOSITORY, objective: 'every change is documented', measures: ['owner_friction_per_item'] })
  const workflow = {
    version: 1,
    objective: { text: 'every change is documented', measures: ['owner_friction_per_item'] },
    stages: [
      {
        n: 1,
        name: 'build',
        purpose: 'the change works and says what it does',
        steps: [
          { n: 1, name: 'run the tests', instruction: 'Write a test for the change, then run npm test until it is green.', gate: 'self', rules: ['test 1.1'], report: ['test result'] },
          { n: 2, name: 'describe the PR', instruction: 'Write the PR description: what changed and why.', gate: 'drillmaster', rules: ['pr 1.1'], report: ['PR text'] },
        ],
      },
      {
        n: 2,
        name: 'review',
        purpose: 'Owner accepts the change',
        steps: [{ n: 1, name: 'Owner approves', instruction: 'Show Owner the PR and ask for approval.', gate: 'owner', rules: ['pr 1.1'], report: ['what to look at'], skippable: 'owner', update: 'minor' }],
      },
    ],
    inputs: [
      {
        name: 'size',
        options: [
          { value: 'small', description: 'one file' },
          { value: 'large', description: 'several files' },
        ],
        set_at: '1.1',
        by: 'agent',
        instruction: 'How big is the change?',
      },
    ],
    policies: [
      { name: 'test', rules: [{ id: '1.1', rule: 'the tests run green before a PR', verified_by: 'the test output' }] },
      { name: 'pr', rules: [{ id: '1.1', rule: 'the PR says what it changes', verified_by: 'reading the PR description' }] },
    ],
    experiments: [
      {
        id: 1,
        change: 'add a build stage',
        purpose: 'Owner had to ask for tests',
        hypothesis: 'A test step means Owner stops asking for tests',
        null_hypothesis: 'The build stage makes no difference to the corrections',
        measure: 'owner_friction_per_item',
        baseline: 1.5,
        baseline_sd: 0.5,
        target: 0.5,
        judge_after: 3,
        started: '2026-11-09',
      },
    ],
  }
  await store.append(projectId(DEMO_DIR), { id: 'demo_change', at: new Date().toISOString(), type: 'workflow_changed', workflow, reason: 'add a build stage' })

  const call = async (args: Record<string, unknown>) => {
    const { name, arguments: toolArgs } = workToolCall('work_report', args)
    return (await app.callTool(DEMO_DIR, name, toolArgs)).structuredContent as any
  }
  const check = (rule: string) => [{ rule, accepted: true, evidence: `checked ${rule}` }]
  const size = [{ name: 'size', value: 'small', explanation: 'one file' }]

  // Item 1: through the Drillmaster gate (rejected once), the Owner gate, delivery, an added step.
  const one = await call({ action: 'start', issue: '#1 CSV export', description: 'Owner wants the report as CSV, with a header line.' })
  await app.hook(DEMO_DIR, 'PostToolUse', { session_id: 'demo', tool_name: 'mcp__x__work_start', tool_input: { issue: '#1 CSV export' }, tool_response: { work_item_id: one.work_item_id } })
  await app.hook(DEMO_DIR, 'PostToolUse', { session_id: 'demo', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } })
  await call({ token: one.agent_token, action: 'report', kind: 'assumption', text: 'CSV uses ; as separator' })
  await call({ token: one.agent_token, action: 'gate', step: '1.1', self_check: check('test 1.1'), text: 'green', inputs: size })
  await call({ token: one.agent_token, action: 'gate', step: '1.2', self_check: check('pr 1.1'), text: 'adds CSV export' })
  await call({ token: one.agent_token, action: 'gate', step: '1.1', self_check: check('test 1.1'), text: 'green', inputs: size })
  reviewer.enqueue('gate', { accepted: true, rule: null, why: 'The PR says what it changes.' })
  await call({ token: one.agent_token, action: 'gate', step: '1.2', self_check: check('pr 1.1'), text: 'adds CSV export, with a What section' })
  await call({ token: one.agent_token, action: 'gate', step: '2.1', text: 'look at src/csv.js' })
  await ownerAnswers(app, DEMO_DIR, () => 'Approve', 'demo')
  await call({ token: one.agent_token, action: 'deliver', pr: '#40', summary: 'CSV export with a header line; the test checks the header.', artifacts: ['after.png'] })
  await call({ token: one.agent_token, action: 'post_mortem', keep: [{ refs: ['step 1.1'], text: 'the gates' }], change: [{ refs: ['tool work_deliver'], text: 'take more file types' }], experiment_reflections: [{ experiment: 1, text: 'experiment 1 helped' }] })
  await app.hook(DEMO_DIR, 'UserPromptSubmit', { session_id: 'demo', prompt: 'you forgot CHANGES.md' })
  await app.hook(DEMO_DIR, 'PostToolUse', { session_id: 'demo', tool_name: 'Edit', tool_input: { file_path: 'CHANGES.md' }, tool_response: {} })
  await call({ token: one.agent_token, action: 'report', kind: 'added_step', text: 'added a CHANGES.md line', why: 'Owner: you forgot CHANGES.md' })
  await app.idle()

  // Item 2: waiting at the Owner gate.
  const two = await call({ action: 'start', issue: '#2 JSON export' })
  await call({ token: two.agent_token, action: 'gate', step: '1.1', self_check: check('test 1.1'), text: 'green', inputs: size })
  reviewer.enqueue('gate', { accepted: true, rule: null, why: 'ok' })
  await call({ token: two.agent_token, action: 'gate', step: '1.2', self_check: check('pr 1.1'), text: 'adds JSON export' })
  await call({ token: two.agent_token, action: 'gate', step: '2.1', text: 'look at src/json.js' })

  const server = await listen(app, VIEWER_PORT, projectId(DEMO_DIR))
  const runServer = await listen(app, RUN_VIEWER_PORT, projectId(runDir))
  process.env.DRILLMASTER_VIEWER_HOME = home
  return async () => {
    await server.close()
    await runServer.close()
  }
}
