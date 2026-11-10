import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { folderKey as projectId } from '../../src/adapters/projects.js'
import { seedWorkflow, testPorts, WORKFLOW_3, workToolCall } from '../helpers.js'

let server: RunningServer
const DIR = '/projects/viewer'
const ID = projectId(DIR)

const get = async (route: string) => {
  const res = await fetch(`${server.url}${route}`)
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: res.headers.get('content-type')?.includes('json') ? ((await res.json()) as any) : await res.text() }
}

beforeAll(async () => {
  const ports = testPorts()
  await seedWorkflow(ports, DIR, WORKFLOW_3)
  const app = new Drillmaster(ports)
  server = await listen(app)
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
  it('lists projects with their summary', async () => {
    const { body } = await get('/api/projects')
    expect(body).toEqual([expect.objectContaining({ id: ID, dir: DIR, workflow_version: '3.0.0', work_items: 1, active: 1 })])
  })

  it("gives a project's full status", async () => {
    const { body } = await get(`/api/projects/${ID}`)
    expect(body.workflow.version).toBe('3.0.0')
    expect(body.versions.map((v: any) => v.version)).toEqual(['0.0.0', '1.0.0', '2.0.0', '3.0.0'])
    expect(body.work_items[0]).toMatchObject({ issue: '#9', status: 'active', stage: 1, step: 2, reports: 2, added_steps: 0 })
    expect(body.measures[0]).toMatchObject({ name: 'owner_corrections_per_item', all: null })
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
