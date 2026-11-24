import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import type { ScriptedReviewer } from '../../src/adapters/reviewers.js'
import { ownerAnswers, seedWorkflow, testPorts, WORKFLOW_DM, workToolCall } from '../helpers.js'

let app: Drillmaster

let server: RunningServer
let reviewer: ScriptedReviewer
const PROJECT = '/projects/gates'
const SESSION = 'gate-session'

const post = async (route: string, body: unknown) => {
  const res = await fetch(`${server.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return (await res.json()) as any
}
const tool = async (name: string, args: unknown) => {
  const body = await post('/tools/call', { project: PROJECT, ...workToolCall(name, args as Record<string, unknown>) })
  return body.isError ? body.content[0].text : body.structuredContent
}
const hook = (event: string, payload: Record<string, unknown>) => post(`/hooks/${event}`, { project: PROJECT, payload: { session_id: SESSION, ...payload } })

beforeAll(async () => {
  const ports = testPorts({
    gate: [
      // 1st review: Drillmaster rejects and sends the work back to 1.1.
      { accepted: false, rule: 'pr 1.1', why: 'The traces show no PR description was written.', back_to: { stage: 1, step: 1 } },
      // 2nd review: an unreadable answer. 3rd: accepted, as text with prose around it.
      'I am not sure.',
      'Verdict: {"accepted": true, "rule": null, "why": "The PR description says what it changes."}',
    ],
  })
  reviewer = ports.reviewer
  await seedWorkflow(ports, PROJECT, WORKFLOW_DM)
  app = new Drillmaster(ports)
  server = await listen(app)
})
afterAll(() => server.close())

describe('a work item through a Drillmaster gate and an Owner gate', () => {
  let token: string
  const r = (args: Record<string, unknown>) => tool('work_report', { token, ...args })
  const gate11 = () => r({ action: 'gate', step: '1.1', self_check: [{ rule: 'test 1.1', accepted: true, evidence: 'green' }], text: 'green' })
  const gate12 = () => r({ action: 'gate', step: '1.2', self_check: [{ rule: 'pr 1.1', accepted: true, evidence: 'PR #40 body' }], text: 'adds CSV export' })

  it('starts and binds the session', async () => {
    await hook('SessionStart', { source: 'startup' })
    const started = await tool('work_report', { action: 'start', issue: '#7' })
    token = started.agent_token
    await hook('PostToolUse', { tool_name: 'mcp__x__work_start', tool_input: { issue: '#1' }, tool_response: { work_item_id: started.work_item_id } })
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } })
    expect(await gate11()).toMatchObject({ verdict: 'accepted', next: { stage: 1, step: 2 } })
  })

  it("Drillmaster rejects with Agent's reports and the work traces in hand", async () => {
    expect(await gate12()).toMatchObject({ verdict: 'rejected', by: 'drillmaster', rule: 'pr 1.1', next: { stage: 1, step: 1 } })
    expect(reviewer.requests[0]!.prompt).toContain('PostToolUse Bash {"command":"npm test"}')
    expect(reviewer.requests[0]!.prompt).toContain('PR #40 body')
  })

  it('keeps the gate pending when Drillmaster cannot judge, and lets Agent hand it in again', async () => {
    expect(await gate11()).toMatchObject({ verdict: 'accepted' })
    expect(await gate12()).toMatchObject({ verdict: 'pending', gate: 'drillmaster' })
    expect((await tool('work_status', { token })).pending_gate).toMatchObject({ gate: 'drillmaster', review_failed: expect.stringMatching(/not a verdict/) })
    expect(await gate12()).toMatchObject({ verdict: 'accepted', by: 'drillmaster', next: { stage: 2, step: 1 } })
  })

  it('waits at the Owner gate until Owner decides it in AskUserQuestion', async () => {
    const owner = await r({ action: 'gate', step: '2.1', text: 'PR #40' })
    expect(owner).toMatchObject({ verdict: 'pending', gate: 'owner' })

    const chat = await hook('UserPromptSubmit', { prompt: 'looks good, ship it' })
    expect(chat.output).toBeUndefined()
    expect(await tool('work_status', { token })).toMatchObject({ pending_gate: { gate: 'owner' } })
    expect(await ownerAnswers(app, PROJECT, () => 'the header row is missing', SESSION)).toMatch(/did not decide the Owner gate of step 2\.1 and said: "the header row is missing"/)
    expect(await tool('work_status', { token })).toMatchObject({ pending_gate: { gate: 'owner' } })
    expect(await ownerAnswers(app, PROJECT, () => ({ answer: 'Reject', notes: 'the header row is missing' }), SESSION)).toMatch(/rejected.*"the header row is missing"/)

    expect(await r({ action: 'gate', step: '2.1', text: 'PR #40' })).toMatchObject({ verdict: 'pending' })
    expect(await ownerAnswers(app, PROJECT, () => 'Approve', SESSION)).toMatch(/approved.*deliver/)

    const status = await tool('work_status', { token })
    expect(status).toMatchObject({ pending_gate: null, gates_done: true, rejections: 2, last_verdict: { by: 'owner', accepted: true } })
    expect(await r({ action: 'deliver', pr: '#40' })).toMatchObject({ delivered: status.work_item_id })
  })
})
