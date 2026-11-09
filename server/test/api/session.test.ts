// One work item through the REST API, the way Claude Code and the shim drive it: hooks for the
// session, tool calls for Agent.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { listen, type RunningServer } from '../../src/daemon/http.js'
import { OBJECTIVE, testPorts } from '../helpers.js'

let server: RunningServer
const PROJECT = '/projects/session'
const SESSION = 'session-1'
const WORK_REPORT = 'mcp__plugin_devops-drillmaster_drillmaster__work_report'

const post = async (route: string, body: unknown) => {
  const res = await fetch(`${server.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}
const hook = (event: string, payload: Record<string, unknown>) => post(`/hooks/${event}`, { project: PROJECT, payload: { session_id: SESSION, ...payload } })
const tool = async (name: string, args: unknown) => {
  const { body } = await post('/tools/call', { project: PROJECT, name, arguments: args })
  return { isError: body.isError === true, value: body.isError ? body.content[0].text : JSON.parse(body.content[0].text) }
}
const state = async () => (await (await fetch(`${server.url}/state?project=${encodeURIComponent(PROJECT)}`)).json()) as any

beforeAll(async () => {
  server = await listen(new Drillmaster(testPorts()))
})
afterAll(() => server.close())

describe('a session on a project without a workflow', () => {
  it('stores nothing and says nothing', async () => {
    expect((await hook('SessionStart', { source: 'startup' })).body).toEqual({ stored: 0 })
    expect((await state()).events).toEqual([])
  })
})

describe('a session working one item on workflow_0', () => {
  let token: string

  it('briefs Agent at SessionStart', async () => {
    await post('/projects/init', { project: PROJECT, objective: OBJECTIVE })
    const { body } = await hook('SessionStart', { source: 'startup' })
    expect(body.output.hookSpecificOutput.additionalContext).toMatch(/Drillmaster runs this project/)
  })

  it('traces Owner\'s instruction', async () => {
    await hook('UserPromptSubmit', { prompt: 'do issue #12' })
  })

  it('starts the work item and binds the session from the PostToolUse hook', async () => {
    const started = await tool('work_report', { action: 'start', issue: '#12' })
    expect(started.value).toMatchObject({ work_item_id: 'wi_1', agent_token: 'secret_1', stage: null, step: null })
    token = started.value.agent_token
    await hook('PostToolUse', {
      tool_name: WORK_REPORT,
      tool_input: { action: 'start', issue: '#12' },
      tool_response: [{ type: 'text', text: JSON.stringify(started.value, null, 2) }],
    })
    expect((await state()).state.sessions[SESSION]).toEqual({ session_id: SESSION, work_item_id: 'wi_1' })
  })

  it('traces every later action to the work item', async () => {
    await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } })
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } })
    await hook('Stop', {})
    const traces = (await state()).events.filter((e: any) => e.type === 'work_trace')
    expect(traces.map((t: any) => [t.hook, t.work_item_id])).toEqual([
      ['SessionStart', null],
      ['UserPromptSubmit', null],
      ['PostToolUse', 'wi_1'],
      ['PreToolUse', 'wi_1'],
      ['PostToolUse', 'wi_1'],
      ['Stop', 'wi_1'],
    ])
  })

  it('never stores Agent\'s token, only its hash', async () => {
    expect(JSON.stringify((await state()).events)).not.toContain(token)
  })

  it('answers work_status for the token holder only', async () => {
    const status = await tool('work_status', { token })
    expect(status.value).toMatchObject({ work_item_id: 'wi_1', issue: '#12', stage: null, step: null, pending_gate: null, sessions: [SESSION], traces: 4 })
    const withTraces = await tool('work_status', { token, last: 5, stage: 1 })
    expect(withTraces.value.reports).toEqual([])
    expect((await tool('work_status', { token: 'stolen' })).isError).toBe(true)
  })

  it('refuses unknown hook events and bad work_report calls', async () => {
    expect((await hook('Bogus', {})).status).toBe(404)
    expect((await tool('work_report', { action: 'start' })).isError).toBe(true)
    expect((await tool('work_report', { action: 'fly' })).isError).toBe(true)
  })
})
