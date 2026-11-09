// One work item through a grown workflow over the REST tool endpoint: build (two self gates),
// then review (an Owner gate, which stays pending until phase 4 resolves it).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { seedWorkflow, testPorts, WORKFLOW_3 } from '../helpers.js'

let server: RunningServer
const PROJECT = '/projects/work'

const tool = async (name: string, args: unknown) => {
  const res = await fetch(`${server.url}/tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: PROJECT, name, arguments: args }),
  })
  const body = (await res.json()) as { isError?: boolean; content: { text: string }[] }
  return { isError: body.isError === true, value: body.isError ? body.content[0]!.text : JSON.parse(body.content[0]!.text) }
}

beforeAll(async () => {
  const ports = testPorts()
  await seedWorkflow(ports, PROJECT, WORKFLOW_3)
  server = await listen(new Drillmaster(ports))
})
afterAll(() => server.close())

describe('a work item through build and review', () => {
  let token: string
  const r = (args: Record<string, unknown>) => tool('work_report', { token, ...args })

  it('starts at work step 1.1', async () => {
    const started = await tool('work_report', { action: 'start', issue: '#7' })
    expect(started.value).toMatchObject({ stage: 1, step: 1 })
    token = started.value.agent_token
    const stage = await tool('workflow_get', { stage: 1 })
    expect(stage.value.steps[0]).toMatchObject({ n: '1.1', gate: 'self', rules: [{ ref: 'test 1.1' }] })
  })

  it('records work reports at the current step', async () => {
    expect((await r({ action: 'report', kind: 'assumption', text: 'CSV uses ; as separator' })).value).toMatchObject({ recorded: 'assumption', stage: 1, step: 1 })
    expect((await r({ action: 'report', kind: 'question', text: 'q' })).isError).toBe(true)
  })

  it('sends a failed self check back, then moves on when it passes', async () => {
    const failed = await r({ action: 'gate', stage: 1, step: 1, self_check: [{ rule: 'test 1.1', accepted: false, evidence: '2 tests red' }], text: 'red' })
    expect(failed.value).toMatchObject({ verdict: 'rejected', next: { stage: 1, step: 1 } })
    const passed = await r({ action: 'gate', stage: 1, step: 1, self_check: [{ rule: 'test 1.1', accepted: true, evidence: 'all green' }], text: 'green' })
    expect(passed.value).toMatchObject({ verdict: 'accepted', next: { stage: 1, step: 2 } })
    const step2 = await r({ action: 'gate', stage: 1, step: 2, self_check: [{ rule: 'pr 1.1', accepted: true, evidence: 'PR body has What' }], text: 'adds CSV export' })
    expect(step2.value).toMatchObject({ verdict: 'accepted', next: { stage: 2, step: 1 } })
  })

  it('waits at the Owner gate and refuses delivery meanwhile', async () => {
    const owner = await r({ action: 'gate', stage: 2, step: 1, self_check: [{ rule: 'pr 1.1', accepted: true, evidence: 'PR #40' }], text: 'PR #40' })
    expect(owner.value).toMatchObject({ verdict: 'pending', gate: 'owner' })
    expect((await r({ action: 'deliver', pr: '#40' })).value).toMatch(/pending/)
  })

  it('shows status, the last reports, and what was captured at a step', async () => {
    const status = await tool('work_status', { token, last: 2, stage: 1, step: 1 })
    expect(status.value).toMatchObject({
      status: 'active',
      stage: 2,
      step: 1,
      pending_gate: { stage: 2, step: 1, gate: 'owner' },
      rejections: 1,
      reports: 5,
      last_verdict: { accepted: true, stage: 1, step: 2 },
    })
    expect(status.value.last_reports.map((x: { type: string }) => x.type)).toEqual(['gate_submitted', 'gate_submitted'])
    expect(status.value.captured.reports.map((x: { type: string }) => x.type)).toEqual(['work_reported', 'gate_submitted', 'gate_submitted'])
  })

  it('rejects calls without a valid token', async () => {
    expect((await tool('work_report', { action: 'report', token: 'nope', kind: 'impediment', text: 'x' })).value).toMatch(/Unknown token/)
  })
})
