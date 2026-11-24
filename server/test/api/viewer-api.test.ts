import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { folderKey as projectId } from '../../src/adapters/projects.js'
import { seedWorkflow, testPorts, WORKFLOW_3, workToolCall } from '../helpers.js'

let server: RunningServer
let app: Drillmaster
const DIR = '/projects/viewer'
const ID = projectId(DIR)

const get = async (route: string) => {
  const res = await fetch(`${server.url}${route}`)
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: res.headers.get('content-type')?.includes('json') ? ((await res.json()) as any) : await res.text() }
}

beforeAll(async () => {
  const ports = testPorts()
  await seedWorkflow(ports, DIR, WORKFLOW_3)
  app = new Drillmaster(ports)
  server = await listen(app, 0, ID)
  const call = (args: Record<string, unknown>) => {
    const { name, arguments: toolArgs } = workToolCall('work_report', args)
    return app.callTool(DIR, name, toolArgs)
  }
  const started = (await call({ action: 'start', issue: '#9' })).structuredContent as { agent_token: string }
  const token = started.agent_token
  await app.hook(DIR, 'UserPromptSubmit', { session_id: 's1', prompt: 'do #9' })
  await call({ token, action: 'report', kind: 'impediment', text: 'no fixtures' })
  await call({ token, action: 'gate', step: '1.1', self_check: [{ rule: 'test 1.1', accepted: true, evidence: 'green' }], text: 'green' })
})
afterAll(() => server.close())

describe('viewer API', () => {
  it('serves what to fix next in Drillmaster, nothing yet for a project with no post mortems', async () => {
    expect(await get(`/api/projects/${ID}/drillmaster`)).toMatchObject({ status: 200, body: { tools: [], uncovered: [] } })
  })

  it('serves the changes to the workflow, none yet for a seeded project', async () => {
    expect(await get(`/api/projects/${ID}/changes`)).toMatchObject({ status: 200, body: [] })
    expect((await get(`/api/projects/${ID}/changes?at=yesterday`)).status).toBe(400)
  })

  it("serves the work items, latest first, and one work item's route at a moment", async () => {
    const [item] = (await get(`/api/projects/${ID}/work-items`)).body.items
    expect(item).toMatchObject({ issue: '#9', status: 'active', at_step: 'say what the pull request changes', marks: [] })
    const page = (await get(`/api/projects/${ID}/work-items/${item.work_item_id}`)).body
    expect(page.stages[0].steps.map((step: { status: string }) => step.status)).toEqual(['passed', 'here'])
    expect(page.stages[0].steps[0].happened.reports).toEqual([{ kind: 'impediment', text: 'no fixtures' }])
    const before = (await get(`/api/projects/${ID}/work-items/${item.work_item_id}?at=${item.started_at}`)).body
    expect(before.stages[0].steps[0].status).toBe('here')
    expect((await get(`/api/projects/${ID}/work-items/wi_unknown`)).status).toBe(404)
    expect((await get(`/api/projects/${ID}/work-items?at=yesterday`)).status).toBe(400)
  })

  it('serves its one project, with its summary, and no other', async () => {
    expect((await get('/api/served')).body).toEqual({ project: ID })
    expect((await get(`/api/projects/${ID}`)).body.summary).toMatchObject({ id: ID, dir: DIR, workflow_version: '3.0.0', work_items: 1, active: 1 })
    expect(await get(`/api/projects/${projectId('/projects/other')}`)).toMatchObject({ status: 404, body: { error: expect.stringMatching(/serves project/) } })
    const otherHook = await fetch(`${server.url}/hooks/SessionStart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: '/projects/other', payload: { session_id: 'x' } }) })
    expect(otherHook.status).toBe(409)
    expect((await get('/health')).body).toMatchObject({ name: 'drillmaster', project: ID })
  })

  it("follows a component of the workflow by its GUID: its versions and what happened at it", async () => {
    const guid = WORKFLOW_3.stages[0]!.steps[0]!.guid
    const { body } = await get(`/api/projects/${ID}/history/${guid}`)
    expect(body).toMatchObject({ kind: 'step', current: { ref: 'step 1.1', title: 'run the tests' } })
    expect(body.versions.map((version: any) => [version.version, version.change])).toEqual([['3.0.0', 'added']])
    expect(body.activity.map((entry: any) => entry.text)).toEqual(['impediment: no fixtures', 'accepted by agent: Self check passed.'])
    expect((await get(`/api/projects/${ID}/history/nothing`)).status).toBe(404)
  })

  it('gives the Workflow page now, or at a moment, and refuses a moment that is no time', async () => {
    const now = (await get(`/api/projects/${ID}/workflow`)).body
    expect(now.workflow_version).toBe('3.0.0')
    expect(now.stages[0].steps.map((step: any) => step.here_now.map((item: any) => item.issue))).toEqual([[], ['#9']])
    const gate = (await app.events(DIR)).find((event) => event.type === 'gate_verdict')!
    const beforeGate = new Date(Date.parse(gate.at) - 1).toISOString()
    const then = (await get(`/api/projects/${ID}/workflow?at=${beforeGate}`)).body
    expect(then.at).toBe(beforeGate)
    expect(then.stages[0].steps.map((step: any) => step.here_now.map((item: any) => item.issue))).toEqual([['#9'], []])
    expect(await get(`/api/projects/${ID}/workflow?at=yesterday`)).toMatchObject({ status: 400, body: { error: expect.stringMatching(/date and time/) } })
    expect((await get(`/api/projects/${projectId('/projects/other')}/workflow`)).status).toBe(404)
  })

  it("gives a project's full status", async () => {
    const { body } = await get(`/api/projects/${ID}`)
    expect(body.workflow.version).toBe('3.0.0')
    expect(body.versions.map((v: any) => v.version)).toEqual(['0.0.0', '1.0.0', '2.0.0', '3.0.0'])
    expect(body.work_items[0]).toMatchObject({ issue: '#9', status: 'active', stage: 1, step: 2, reports: 2, added_steps: 0 })
    expect(body.measures[0]).toMatchObject({ name: 'owner_friction_per_item', all: null })
    expect(body.retrospectives).toEqual([])
  })

  it("gives a work item's timeline, without its token hash", async () => {
    const { body: project } = await get(`/api/projects/${ID}`)
    const { body } = await get(`/api/projects/${ID}/items/${project.work_items[0].work_item_id}`)
    expect(body.timeline.map((e: any) => e.type)).toEqual(['work_item_started', 'work_reported', 'gate_submitted', 'gate_verdict'])
    expect(body.item).not.toHaveProperty('token_hash')
    expect(JSON.stringify(body)).not.toContain('token_hash')
  })

  it('answers 404 for unknown projects and work items', async () => {
    expect((await get('/api/projects/nope')).status).toBe(404)
    expect((await get(`/api/projects/${ID}/items/nope`)).status).toBe(404)
  })

  it('serves the viewer, or says how to build it', async () => {
    const { status, body } = await get('/')
    const built = status === 200 && String(body).includes('<div id="root">')
    const notBuilt = status === 404 && String(body).includes('npm run build')
    expect(built || notBuilt).toBe(true)
  })
})
