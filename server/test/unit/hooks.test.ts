import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { exitCodeOf, handleHook, outputTailForTrace, redactTokens, takenUpWorkItemId, truncateForTrace } from '../../src/core/hooks.js'
import { foldState } from '../../src/core/state.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE } from '../helpers.js'

const at = '2026-11-09T10:00:00Z'
const INIT: DrillmasterEvent = { id: 'ev_1', at, type: 'project_initialized', dir: '/p', workflow: workflowZero(OBJECTIVE as never) }
const STARTED: DrillmasterEvent = {
  id: 'ev_2',
  at,
  type: 'work_item_started',
  work_item_id: 'wi_1',
  issue: '#12',
  workflow_version: '0.0.0',
  token_hash: 'h',
  stage: null,
  step: null,
}

/** The shape Claude Code gives a PostToolUse for an MCP tool: the result's text holds our JSON. */
const startResponse = { content: [{ type: 'text', text: JSON.stringify({ work_item_id: 'wi_1', agent_token: 'secret_1' }, null, 2) }] }
const markdownStartResponse = [{ type: 'text', text: '# Work item wi_1 started: #12\n\nwork_item_id: wi_1\nagent_token: secret_1\n' }]

describe('handling hooks', () => {
  it('ignores projects without a workflow', () => {
    expect(handleHook(foldState([]), 'SessionStart', { session_id: 's1' }, false)).toEqual({ events: [] })
  })

  it('registers a session at SessionStart and briefs Agent', () => {
    const outcome = handleHook(foldState([INIT]), 'SessionStart', { session_id: 's1', source: 'startup' }, false)
    expect(outcome.events.map((e) => e.type)).toEqual(['session_registered', 'work_trace'])
    const context = (outcome.output as any).hookSpecificOutput.additionalContext as string
    expect(context).toMatch(/workflow version 0.0.0/)
    expect(context).toMatch(/work_start tool/)
    expect(context).toMatch(/no work stages yet/)
  })

  it('registers a session it sees first in a later hook as implicit', () => {
    const outcome = handleHook(foldState([INIT]), 'PreToolUse', { session_id: 's9', tool_name: 'Bash', tool_input: { command: 'ls' } }, false)
    expect(outcome.events[0]).toEqual({ type: 'session_registered', session_id: 's9', source: 'implicit' })
    expect(outcome.events[1]).toMatchObject({ type: 'work_trace', hook: 'PreToolUse', tool: 'Bash', input: '{"command":"ls"}', work_item_id: null })
  })

  it('binds the session when its work_start succeeds, and traces it to the work item', () => {
    const state = foldState([INIT, { id: 'ev_s', at, type: 'session_registered', session_id: 's1', source: 'startup' }, STARTED])
    const outcome = handleHook(
      state,
      'PostToolUse',
      { session_id: 's1', tool_name: 'mcp__plugin_devops-drillmaster_drillmaster__work_start', tool_input: { issue: '#12', description: 'd' }, tool_response: markdownStartResponse },
      false,
    )
    expect(outcome.events).toEqual([
      { type: 'session_bound', session_id: 's1', work_item_id: 'wi_1' },
      expect.objectContaining({ type: 'work_trace', work_item_id: 'wi_1', error: false }),
    ])
  })

  it('tells a session on a work item that is delivered that it is, not that it is at no work stage yet', () => {
    const bound = [INIT, { id: 'ev_s', at, type: 'session_registered', session_id: 's1', source: 'startup' }, STARTED, { id: 'ev_b', at, type: 'session_bound', session_id: 's1', work_item_id: 'wi_1' }] as DrillmasterEvent[]
    const brief = (events: DrillmasterEvent[]) => (handleHook(foldState(events), 'SessionStart', { session_id: 's1', source: 'resume' }, false).output as any).hookSpecificOutput.additionalContext as string
    expect(brief(bound)).toMatch(/You are on work item wi_1/)
    const delivered = brief([...bound, { id: 'ev_d', at, type: 'work_item_delivered', work_item_id: 'wi_1', pr: 'local' } as DrillmasterEvent])
    expect(delivered).toMatch(/Your last work item, wi_1 \(#12\), is delivered\..*start new work with work_start/)
    expect(delivered).not.toMatch(/You are on work item/)
  })

  it('records Owner\'s words and keeps raw payloads only when recording', () => {
    const payload = { session_id: 's1', prompt: 'you never ran the tests' }
    const plain = handleHook(foldState([INIT]), 'UserPromptSubmit', payload, false)
    expect(plain.events[1]).toMatchObject({ prompt: 'you never ran the tests' })
    expect(plain.events[1]).not.toHaveProperty('raw')
    expect(handleHook(foldState([INIT]), 'UserPromptSubmit', payload, true).events[1]).toMatchObject({ raw: payload })
  })

  it('marks failed tools', () => {
    const outcome = handleHook(foldState([INIT]), 'PostToolUse', { session_id: 's1', tool_name: 'Bash', tool_response: { is_error: true } }, false)
    expect(outcome.events[1]).toMatchObject({ error: true })
  })

  it('keeps the tail of a tool result, its exit code, and redacts secrets in it', () => {
    const stdout = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\nGITHUB=ghp_abcdefghijklmnopqrstuvwxyz0123'
    const outcome = handleHook(
      foldState([INIT]),
      'PostToolUse',
      { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout, stderr: 'FAIL 1 test', exit_code: 1 } },
      false,
    )
    const trace = outcome.events[1] as { output: string; exit_code: number; error: boolean }
    expect(trace).toMatchObject({ exit_code: 1, error: true })
    expect(trace.output.split('\n')).toHaveLength(20)
    expect(trace.output).toMatch(/FAIL 1 test$/)
    expect(trace.output).not.toContain('ghp_')
    expect(trace.output).not.toContain('line 1\n')
  })
})

describe('recorded payloads from a real Claude Code session', () => {
  it('binds the session from the real work_start response', async () => {
    const { readFile } = await import('node:fs/promises')
    const fixture = JSON.parse(
      await readFile(new URL('../hooks/fixtures/recorded-posttooluse-work_start.json', import.meta.url), 'utf8'),
    ) as { payload: Record<string, unknown> }
    const id = takenUpWorkItemId({ ...fixture.payload, hook_event_name: 'PostToolUse' })
    expect(id).toMatch(/^wi_/)
    const state = foldState([INIT, { ...STARTED, work_item_id: id! }])
    const outcome = handleHook(state, 'PostToolUse', fixture.payload, false)
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'session_bound', work_item_id: id }))
  })
})

describe('hook helpers', () => {
  it('finds the work item only in a work_start or work_resume response', () => {
    const base = { hook_event_name: 'PostToolUse', tool_name: 'work_start', tool_input: { issue: '#1' } }
    expect(takenUpWorkItemId({ ...base, tool_response: startResponse })).toBe('wi_1')
    expect(takenUpWorkItemId({ ...base, tool_response: markdownStartResponse })).toBe('wi_1')
    expect(takenUpWorkItemId({ ...base, tool_response: { work_item_id: 'wi_7' } })).toBe('wi_7')
    expect(takenUpWorkItemId({ ...base, tool_name: 'work_report', tool_response: startResponse })).toBeUndefined()
    expect(takenUpWorkItemId({ ...base, tool_name: 'Bash', tool_response: startResponse })).toBeUndefined()
    expect(takenUpWorkItemId({ ...base, tool_name: 'mcp__plugin_devops-drillmaster_drillmaster__work_resume', tool_response: { work_item_id: 'wi_3' } })).toBe('wi_3')
  })

  it('redacts tokens in objects and in JSON text', () => {
    expect(redactTokens({ token: 'abc', nested: { agent_token: 'def', n: 1 } })).toEqual({ token: '[redacted]', nested: { agent_token: '[redacted]', n: 1 } })
    expect(redactTokens(JSON.stringify({ agent_token: 'abc' }, null, 2))).not.toContain('abc')
    expect(redactTokens(JSON.stringify(JSON.stringify({ token: 'abc' })))).not.toContain('abc')
    expect(redactTokens('work_item_id: wi_1\nagent_token: Zx9_secret-1\n')).toBe('work_item_id: wi_1\nagent_token: [redacted]\n')
  })

  it('redacts well-known secret formats', () => {
    const text = [
      'key sk-ant-abcdefghijklmnop1234',
      'aws AKIAABCDEFGHIJKLMNOP',
      'slack xoxb-1234567890-abcdef',
      'pat github_pat_11ABCDEFG0123456789abcdef',
      'DB_PASSWORD=hunter2',
      'api_key: "abc123"',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
    ].join('\n')
    const redacted = redactTokens(text) as string
    for (const secret of ['sk-ant-abc', 'AKIAABCD', 'xoxb-123', 'github_pat_11', 'hunter2', 'abc123', 'MIIE']) expect(redacted).not.toContain(secret)
    expect(redacted).toContain('DB_PASSWORD=[redacted]')
  })

  it('reads output and exit codes from the shapes tools return', () => {
    expect(outputTailForTrace({ stdout: 'hello', stderr: '' })).toBe('hello')
    expect(outputTailForTrace([{ type: 'text', text: 'from mcp' }])).toBe('from mcp')
    expect(outputTailForTrace({ content: [{ type: 'text', text: 'wrapped' }] })).toBe('wrapped')
    expect(outputTailForTrace({ stdout: '', stderr: '' })).toBe('{"stdout":"","stderr":""}')
    expect(outputTailForTrace(undefined)).toBeUndefined()
    expect(exitCodeOf({ exitCode: 2 })).toBe(2)
    expect(exitCodeOf({ stdout: 'x' })).toBeUndefined()
  })

  it('keeps tool inputs short', () => {
    expect(truncateForTrace('x'.repeat(600))).toHaveLength(600)
    expect(truncateForTrace('x'.repeat(2500))).toHaveLength(2003)
    expect(truncateForTrace(undefined)).toBeUndefined()
  })
})
