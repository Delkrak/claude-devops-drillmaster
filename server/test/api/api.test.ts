import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { OBJECTIVE, testPorts } from '../helpers.js'

let server: RunningServer
const PROJECT = '/projects/dummy'

const call = async (method: 'GET' | 'POST', route: string, body?: unknown) => {
  const res = await fetch(`${server.url}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

beforeAll(async () => {
  server = await listen(new Drillmaster(testPorts()))
})
afterAll(() => server.close())

describe('REST API', () => {
  it('answers health', async () => {
    expect(await call('GET', '/health')).toMatchObject({ status: 200, body: { ok: true, name: 'drillmaster' } })
  })

  it('has no workflow before init', async () => {
    const { body } = await call('POST', '/tools/call', { project: PROJECT, name: 'workflow_get', arguments: {} })
    expect(body).toMatchObject({ isError: true })
    expect(body.content[0].text).toMatch(/no workflow yet/)
  })

  it('refuses an invalid objective', async () => {
    const res = await call('POST', '/projects/init', { project: PROJECT, objective: { text: 'x', measures: ['joy'] } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid objective/)
  })

  it('creates workflow_0 once', async () => {
    const first = await call('POST', '/projects/init', { project: PROJECT, objective: OBJECTIVE })
    expect(first).toMatchObject({ status: 201, body: { workflow: { version: '0.0.0', stages: [] } } })
    const second = await call('POST', '/projects/init', { project: PROJECT, objective: OBJECTIVE })
    expect(second.status).toBe(409)
  })

  it('shows the events and the folded state', async () => {
    const { status, body } = await call('GET', `/state?project=${encodeURIComponent(PROJECT)}`)
    expect(status).toBe(200)
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({ id: 'ev_1', at: '2026-11-09T10:00:00.000Z', type: 'project_initialized' })
    expect(body.state).toMatchObject({ initialized: true, workflow: { version: '0.0.0' } })
  })

  it('lists the tools and answers workflow_get', async () => {
    expect((await call('GET', '/tools')).body.tools.map((t: { name: string }) => t.name)).toEqual(['workflow_get', 'work_start', 'work_skip', 'work_report', 'work_gate', 'work_deliver', 'work_post_mortem', 'workflow_retrospective', 'work_status'])
    const { body } = await call('POST', '/tools/call', { project: PROJECT, name: 'workflow_get', arguments: {} })
    expect(body.structuredContent).toMatchObject({ kind: 'overview', version: '0.0.0', objective: OBJECTIVE, stages: [] })
  })

  it('reports bad tool calls as tool errors, and bad requests as HTTP errors', async () => {
    const unknown = await call('POST', '/tools/call', { project: PROJECT, name: 'nope' })
    expect(unknown.body).toMatchObject({ isError: true })
    const badArgs = await call('POST', '/tools/call', { project: PROJECT, name: 'workflow_get', arguments: { stage: 0 } })
    expect(badArgs.body).toMatchObject({ isError: true })
    expect((await call('POST', '/tools/call', { name: 'workflow_get' })).status).toBe(400)
    expect((await call('GET', '/nowhere')).status).toBe(404)
  })
})
