import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { projectId } from '../../src/env.js'
import { OBJECTIVE, tempDir, testPorts } from '../helpers.js'

let root: Awaited<ReturnType<typeof tempDir>>
let storeRepo: string
let work: string
let app: Drillmaster
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const branchesOf = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname:short)').split('\n').filter(Boolean).sort()
const check = (rule: string) => [{ rule, accepted: true, evidence: 'checked' }]

const testRule = { id: '1.1', rule: 'the tests run green', verified_by: 'the test output' }
const retrospective = {
  findings: { should: 's', did: 'd', why: 'w', keep: 'k', improve: 'i' },
  proposals: [
    {
      id: 1,
      change: 'a build stage that runs the tests',
      purpose: 'Owner asked for tests',
      measure: 'owner_corrections_per_item',
      hypothesis: 'no more asking',
      ops: [
        { op: 'add_policy', name: 'test', rules: [testRule] },
        { op: 'add_stage', name: 'build', purpose: 'it works', steps: [{ name: 'run the tests', instruction: 'Run npm test.', gate: 'self', rules: ['test 1.1'], report: ['result'] }] },
        { op: 'add_stage', name: 'ship', purpose: 'it is out', steps: [{ name: 'tag it', instruction: 'Tag the release.', gate: 'self', rules: [], report: [] }] },
      ],
    },
  ],
}
const postMortem = { keep: 'k', change: 'c', experiment_reflections: 'e', free_text: '' }

const tokenByIssue: Record<string, string> = {}

async function startItem(issue: string) {
  const started = await app.callTool(work, 'work_start', { issue, description: `work on ${issue}` })
  const { agent_token: token, work_item_id: workItemId } = started.structuredContent as { agent_token: string; work_item_id: string }
  tokenByIssue[issue] = token
  return { token, workItemId }
}

beforeAll(async () => {
  root = await tempDir('git-store-api')
  storeRepo = path.join(root.dir, 'store.git')
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', storeRepo])
  work = path.join(root.dir, 'work')
  await mkdir(work)
  execFileSync('git', ['init', '--quiet'], { cwd: work })
  app = new Drillmaster(testPorts({ retrospective: [retrospective], post_mortem: [postMortem, postMortem] }), { store: { writer: 'w_a', clonesRoot: path.join(root.dir, 'clones-a') } })
})
afterAll(() => root.remove())

describe('a project kept in a git store', () => {
  it('sets up with the store: a first push, and the pin and workflow copy in the work folder', async () => {
    const setup = await app.callTool(work, 'workflow_retrospective', { action: 'setup', objective: OBJECTIVE.text, measures: OBJECTIVE.measures, store: { repo: storeRepo } })
    expect(setup.isError).toBeUndefined()
    await app.idle()
    const link = JSON.parse(await readFile(path.join(work, '.drillmaster', 'drillmaster.json'), 'utf8'))
    expect(link).toMatchObject({ project: projectId(work), store: { repo: storeRepo, path: projectId(work) } })
    expect(JSON.parse(await readFile(path.join(work, '.drillmaster', 'workflow.json'), 'utf8'))).toMatchObject({ version: '0.0.0' })
    expect(git(storeRepo, 'show', `main:${projectId(work)}/project/w_a.jsonl`)).toContain('"project_initialized"')
  })

  it('refuses a store that does not take a push', async () => {
    const other = path.join(root.dir, 'other')
    await mkdir(other)
    const refused = await app.callTool(other, 'workflow_retrospective', { action: 'setup', objective: 'x', measures: OBJECTIVE.measures, store: { repo: path.join(root.dir, 'nowhere.git') } })
    expect(refused).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/does not take a push/) }] })
  })

  it('updates the workflow copy after a retrospective', async () => {
    await app.callTool(work, 'workflow_retrospective', { action: 'run' })
    await app.hook(work, 'UserPromptSubmit', { session_id: 's1', prompt: 'approve 1' })
    await app.callTool(work, 'workflow_retrospective', { action: 'apply' })
    expect(JSON.parse(await readFile(path.join(work, '.drillmaster', 'workflow.json'), 'utf8'))).toMatchObject({ version: '1.0.0', stages: [{ name: 'build' }, { name: 'ship' }] })
  })

  it('rewrites a hand-edited copy of the workflow, and says so at SessionStart', async () => {
    const workflowFile = path.join(work, '.drillmaster', 'workflow.json')
    await writeFile(workflowFile, (await readFile(workflowFile, 'utf8')).replace('Run npm test.', 'Skip the tests.'))
    const brief = await app.hook(work, 'SessionStart', { session_id: 's2', source: 'startup' })
    expect((brief.output as any).hookSpecificOutput.additionalContext).toContain('had been edited by hand, and Drillmaster rewrote it')
    expect(await readFile(workflowFile, 'utf8')).toContain('Run npm test.')
  })

  it('keeps each open work item on its own branch, pushed at each stage end', async () => {
    const one = await startItem('#1')
    const two = await startItem('#2')
    await app.callTool(work, 'work_gate', { token: one.token, stage: 1, step: 1, self_check: check('test 1.1'), text: 'green' })
    await app.callTool(work, 'work_gate', { token: two.token, stage: 1, step: 1, self_check: check('test 1.1'), text: 'green' })
    await app.idle()
    expect(branchesOf(storeRepo)).toEqual([`drillmaster/${one.workItemId}`, `drillmaster/${two.workItemId}`, 'main'])
    expect(git(storeRepo, 'show', `drillmaster/${one.workItemId}:${projectId(work)}/items/${one.workItemId}/w_a.jsonl`)).toContain('"gate_verdict"')
    expect(git(storeRepo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain(`items/${one.workItemId}`)
  })

  it('squash-merges a work item into main once its workflow is complete, and deletes its branch', async () => {
    const item = Object.values((await app.state(work)).workItems).find((candidate) => candidate.issue === '#1')!
    const itemToken = tokenByIssue['#1']!
    await app.callTool(work, 'work_gate', { token: itemToken, stage: 2, step: 1, self_check: [], text: 'tagged' })
    await app.callTool(work, 'work_deliver', { token: itemToken, pr: '#40', summary: 'done' })
    await app.callTool(work, 'work_post_mortem', { token: itemToken, ...postMortem })
    await app.idle()
    expect(branchesOf(storeRepo)).not.toContain(`drillmaster/${item.work_item_id}`)
    expect(git(storeRepo, 'log', '-1', '--format=%s', 'main')).toBe(`${item.work_item_id} (#1): delivered as #40 on workflow 1.0.0, 0 gate rejections`)
    expect(git(storeRepo, 'show', `main:${projectId(work)}/items/${item.work_item_id}/w_a.jsonl`)).toContain('"post_mortem_written"')
  })

  it('gives a second machine the project from the store, without duplicates', async () => {
    const second = path.join(root.dir, 'second')
    await mkdir(path.join(second, '.drillmaster'), { recursive: true })
    await writeFile(path.join(second, '.drillmaster', 'drillmaster.json'), await readFile(path.join(work, '.drillmaster', 'drillmaster.json'), 'utf8'))
    const portsB = testPorts()
    const idsOfA = portsB.ids
    // Sequential ids would repeat machine A's; real servers use random ones.
    portsB.ids = { next: (prefix) => `b_${idsOfA.next(prefix)}`, secret: () => idsOfA.secret() }
    const machineB = new Drillmaster(portsB, { store: { writer: 'w_b', clonesRoot: path.join(root.dir, 'clones-b') } })
    await machineB.hook(second, 'SessionStart', { session_id: 'b1', source: 'startup' })
    await machineB.idle()
    await machineB.hook(second, 'SessionStart', { session_id: 'b2', source: 'startup' })
    await machineB.idle()
    const imported = await machineB.events(second)
    expect(new Set(imported.map((event) => event.id)).size).toBe(imported.length)
    const state = await machineB.state(second)
    expect(state.workflow).toMatchObject({ version: '1.0.0' })
    expect(Object.values(state.workItems).map((item) => item.issue).sort()).toEqual(['#1', '#2'])
  })
})
