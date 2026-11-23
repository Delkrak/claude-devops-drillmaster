import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DotDrillmasterResolver, projectKey } from '../../src/adapters/projects.js'
import { RepositoryPublisher } from '../../src/adapters/repositoryPublisher.js'
import { Drillmaster } from '../../src/app.js'
import { VERSION } from '../../src/version.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, ownerAnswers, tempDir, testPorts } from '../helpers.js'

let root: Awaited<ReturnType<typeof tempDir>>
let drillmasterRepository: string
let work: string
let app: Drillmaster
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const branchesOf = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname:short)').split('\n').filter(Boolean).sort()
const check = (rule: string) => [{ rule, accepted: true, evidence: 'checked' }]
const textOf = (result: { content: { text: string }[] }) => result.content[0]!.text

const testRule = { id: '1.1', rule: 'the tests run green', verified_by: 'the test output' }
const buildAndShip = {
  findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] },
  proposals: [
    {
      id: 1,
      change: 'a build stage that runs the tests',
      purpose: 'Owner asked for tests',
      measure: 'owner_friction_per_item',
      hypothesis: 'no more asking',
      ops: [
        { op: 'add_policy', name: 'test', rules: [testRule] },
        { op: 'add_stage', name: 'build', purpose: 'it works', steps: [{ name: 'run the tests', instruction: 'Run npm test.', gate: 'self', rules: ['test 1.1'], report: ['result'] }] },
        { op: 'add_stage', name: 'ship', purpose: 'it is out', steps: [{ name: 'tag it', instruction: 'Tag the release.', gate: 'self', rules: [], report: [] }] },
      ],
    },
  ],
}
const timeIt = { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [{ id: 1, change: 'time it', purpose: 'p', measure: 'minutes_per_item', ops: [{ op: 'set_objective', measures: ['minutes_per_item'] }] }] }
const postMortem = { keep: [{ refs: [], text: 'k' }], change: [{ refs: [], text: 'c' }], experiment_reflections: [] }

const tokenByIssue: Record<string, string> = {}

async function startItem(issue: string) {
  const started = await app.callTool(work, 'work_start', { issue, description: `work on ${issue}` })
  const { agent_token: token, work_item_id: workItemId } = started.structuredContent as { agent_token: string; work_item_id: string }
  tokenByIssue[issue] = token
  return { token, workItemId }
}

const machine = (writer: string, script: Record<string, unknown[]> = {}) => {
  const ports = { ...testPorts(script), projects: new DotDrillmasterResolver() }
  // Sequential ids would repeat another machine's; real servers use random ones.
  const ids = ports.ids
  ports.ids = { next: (prefix) => `${writer}_${ids.next(prefix)}`, secret: () => ids.secret() }
  return new Drillmaster(ports, { repositories: { writer, projectsRoot: path.join(root.dir, `home-${writer}`, 'projects') } })
}

beforeAll(async () => {
  root = await tempDir('drillmaster-repository-api')
  drillmasterRepository = path.join(root.dir, 'drillmaster.git')
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', drillmasterRepository])
  work = path.join(root.dir, 'work')
  await mkdir(work)
  execFileSync('git', ['init', '--quiet'], { cwd: work })
  app = machine('w_a', { retrospective: [buildAndShip, timeIt], post_mortem: [postMortem, postMortem] })
})
afterAll(() => root.remove())

describe('a project kept in its Drillmaster repository', () => {
  it('traces nothing in a folder without .drillmaster, where setup is the only tool', async () => {
    expect(await app.hook(work, 'SessionStart', { session_id: 's0', source: 'startup' })).toEqual({ stored: 0, output: undefined })
    expect(textOf(await app.callTool(work, 'work_start', { issue: '#1', description: 'd' }))).toMatch(/not a Drillmaster project: it has no .drillmaster file/)
  })

  it('sets up by pushing the pin and workflow 0.0.0 to main first, then naming the repository in .drillmaster', async () => {
    const setup = await app.callTool(work, 'workflow_retrospective', { action: 'setup', objective: OBJECTIVE.text, measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'shop' })
    expect(setup.isError).toBeUndefined()
    await app.idle()
    expect(JSON.parse(await readFile(path.join(work, '.drillmaster'), 'utf8'))).toEqual({ drillmaster_repository: drillmasterRepository, folder: 'shop' })
    expect(JSON.parse(git(drillmasterRepository, 'show', 'main:shop/drillmaster.json'))).toEqual({ drillmaster_version: VERSION })
    expect(JSON.parse(git(drillmasterRepository, 'show', 'main:shop/workflow.json'))).toMatchObject({ version: '0.0.0', objective: OBJECTIVE })
    expect(git(drillmasterRepository, 'show', 'main:shop/project/w_a.jsonl')).toContain('"project_initialized"')
  })

  it('refuses a repository that does not take a push, and a folder that holds a project, writing nothing', async () => {
    const other = path.join(root.dir, 'other')
    await mkdir(other)
    const nowhere = await app.callTool(other, 'workflow_retrospective', { action: 'setup', objective: 'x', measures: OBJECTIVE.measures, drillmaster_repository: path.join(root.dir, 'nowhere.git') })
    expect(textOf(nowhere)).toMatch(/does not take a push/)
    const taken = await app.callTool(other, 'workflow_retrospective', { action: 'setup', objective: 'x', measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'shop' })
    expect(textOf(taken)).toMatch(/Folder "shop" of .* already holds a Drillmaster project/)
    expect(existsSync(path.join(other, '.drillmaster'))).toBe(false)
    const moved = await app.callTool(work, 'workflow_retrospective', { action: 'setup', objective: 'x', measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'elsewhere' })
    expect(textOf(moved)).toMatch(/belongs to the project in .* \(folder shop\), as its .drillmaster says/)
  })

  it('refuses a folder with an old .drillmaster folder before it pushes anything, saying what to do', async () => {
    const old = path.join(root.dir, 'old-coach')
    await mkdir(path.join(old, '.drillmaster'), { recursive: true })
    const refused = await app.callTool(old, 'workflow_retrospective', { action: 'setup', objective: OBJECTIVE.text, measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'old-coach' })
    expect(textOf(refused)).toMatch(/has a .drillmaster folder, left by an older Drillmaster .* Move it out of the way or delete it, then run setup again/)
    expect(() => git(drillmasterRepository, 'show', 'main:old-coach/workflow.json')).toThrow()
  })

  it('finishes a setup that pushed to main and then failed before it linked the work folder', async () => {
    const half = path.join(root.dir, 'half')
    await mkdir(half)
    const place = { url: drillmasterRepository, folder: 'half' }
    await RepositoryPublisher.forProject(path.join(root.dir, 'home-w_a', 'projects'), projectKey(place), place, 'w_a').setUp(workflowZero(OBJECTIVE as never), VERSION)
    expect(JSON.parse(git(drillmasterRepository, 'show', 'main:half/workflow.json'))).toMatchObject({ version: '0.0.0' })
    const again = await app.callTool(half, 'workflow_retrospective', { action: 'setup', objective: OBJECTIVE.text, measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'half' })
    expect(again.isError).toBeUndefined()
    expect(JSON.parse(await readFile(path.join(half, '.drillmaster'), 'utf8'))).toEqual({ drillmaster_repository: drillmasterRepository, folder: 'half' })
    expect(textOf(await app.callTool(half, 'workflow_get', {}))).not.toMatch(/no workflow yet/)
    const otherObjective = await app.callTool(path.join(root.dir, 'other'), 'workflow_retrospective', { action: 'setup', objective: 'something else', measures: OBJECTIVE.measures, drillmaster_repository: drillmasterRepository, folder: 'half' })
    expect(textOf(otherObjective)).toMatch(/Folder "half" of .* already holds a Drillmaster project/)
  })

  it('pushes each workflow change to main before it applies, so main has the workflow history', async () => {
    await app.callTool(work, 'workflow_retrospective', { action: 'run' })
    await ownerAnswers(app, work, () => 'Approve')
    const applied = await app.callTool(work, 'workflow_retrospective', { action: 'apply' })
    expect(applied.structuredContent).toMatchObject({ workflow_version: '1.0.0' })
    expect(JSON.parse(git(drillmasterRepository, 'show', 'main:shop/workflow.json'))).toMatchObject({ version: '1.0.0', stages: [{ name: 'build' }, { name: 'ship' }] })
    expect(git(drillmasterRepository, 'log', '--format=%s', 'main', '--', 'shop/workflow.json').split('\n')).toEqual(['workflow 1.0.0: a build stage that runs the tests', 'shop: set up, workflow 0.0.0'])
  })

  it("doesn't apply a change main didn't take, because another machine changed the workflow first", async () => {
    const elsewhere = path.join(root.dir, 'elsewhere')
    git(root.dir, 'clone', '--quiet', drillmasterRepository, elsewhere)
    const onMain = JSON.parse(await readFile(path.join(elsewhere, 'shop', 'workflow.json'), 'utf8'))
    await writeFile(path.join(elsewhere, 'shop', 'workflow.json'), JSON.stringify({ ...onMain, version: '1.1.0' }, null, 2) + '\n')
    git(elsewhere, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-am', 'workflow 1.1.0 from another machine')
    git(elsewhere, 'push', '--quiet', 'origin', 'main')

    await app.callTool(work, 'workflow_retrospective', { action: 'run' })
    await ownerAnswers(app, work, () => 'Approve')
    const refused = await app.callTool(work, 'workflow_retrospective', { action: 'apply' })
    expect(textOf(refused)).toMatch(/didn't take workflow 1.1.0, so it doesn't apply: The workflow on main is version 1.1.0, not 1.0.0/)
    expect((await app.state(work)).workflow?.version).toBe('1.0.0')
  })

  it('keeps each open work item on its own branch, pushed at each stage end', async () => {
    const one = await startItem('#1')
    const two = await startItem('#2')
    await app.callTool(work, 'work_gate', { token: one.token, step: '1.1', self_check: check('test 1.1'), text: 'green' })
    await app.callTool(work, 'work_gate', { token: two.token, step: '1.1', self_check: check('test 1.1'), text: 'green' })
    await app.idle()
    expect(branchesOf(drillmasterRepository)).toEqual([`drillmaster/${one.workItemId}`, `drillmaster/${two.workItemId}`, 'main'])
    expect(git(drillmasterRepository, 'show', `drillmaster/${one.workItemId}:shop/items/${one.workItemId}/w_a.jsonl`)).toContain('"gate_verdict"')
    expect(git(drillmasterRepository, 'ls-tree', '-r', '--name-only', 'main')).not.toContain(`items/${one.workItemId}`)
  })

  it('squash-merges a work item into main once its workflow is complete, and deletes its branch', async () => {
    const item = Object.values((await app.state(work)).workItems).find((candidate) => candidate.issue === '#1')!
    const itemToken = tokenByIssue['#1']!
    await app.callTool(work, 'work_gate', { token: itemToken, step: '2.1', self_check: [], text: 'tagged' })
    await writeFile(path.join(work, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await app.callTool(work, 'work_deliver', { token: itemToken, pr: '#40', summary: 'done', artifacts: ['shot.png'] })
    await app.callTool(work, 'work_post_mortem', { token: itemToken, ...postMortem })
    await app.idle()
    expect(branchesOf(drillmasterRepository)).not.toContain(`drillmaster/${item.work_item_id}`)
    expect(git(drillmasterRepository, 'log', '-1', '--format=%s', 'main')).toBe(`${item.work_item_id} (#1): delivered as #40 on workflow 1.0.0, 0 gate rejections`)
    expect(git(drillmasterRepository, 'show', `main:shop/items/${item.work_item_id}/w_a.jsonl`)).toContain('"post_mortem_written"')
    expect(git(drillmasterRepository, 'cat-file', '-s', `main:shop/items/${item.work_item_id}/artifacts/shot.png`)).toBe('4')
  })

  it('gives a second machine the project from its .drillmaster alone, without duplicates', async () => {
    const second = path.join(root.dir, 'second')
    await mkdir(second)
    await writeFile(path.join(second, '.drillmaster'), await readFile(path.join(work, '.drillmaster'), 'utf8'))
    const machineB = machine('w_b')
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
