import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { handleHook, redact, startedWorkItem, summarize } from '../../src/core/hooks.js'
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
  workflow_version: 0,
  token_hash: 'h',
  stage: null,
  step: null,
}

/** The shape Claude Code gives a PostToolUse for an MCP tool: the result's text holds our JSON. */
const startResponse = { content: [{ type: 'text', text: JSON.stringify({ work_item_id: 'wi_1', agent_token: 'secret_1' }, null, 2) }] }

describe('handling hooks', () => {
  it('ignores projects without a workflow', () => {
    expect(handleHook(foldState([]), 'SessionStart', { session_id: 's1' }, false)).toEqual({ events: [] })
  })

  it('registers a session at SessionStart and briefs Agent', () => {
    const outcome = handleHook(foldState([INIT]), 'SessionStart', { session_id: 's1', source: 'startup' }, false)
    expect(outcome.events.map((e) => e.type)).toEqual(['session_registered', 'work_trace'])
    const context = (outcome.output as any).hookSpecificOutput.additionalContext as string
    expect(context).toMatch(/workflow version 0/)
    expect(context).toMatch(/work_report tool \(action "start"\)/)
    expect(context).toMatch(/no work stages yet/)
  })

  it('registers a session it sees first in a later hook as implicit', () => {
    const outcome = handleHook(foldState([INIT]), 'PreToolUse', { session_id: 's9', tool_name: 'Bash', tool_input: { command: 'ls' } }, false)
    expect(outcome.events[0]).toEqual({ type: 'session_registered', session_id: 's9', source: 'implicit' })
    expect(outcome.events[1]).toMatchObject({ type: 'work_trace', hook: 'PreToolUse', tool: 'Bash', input: '{"command":"ls"}', work_item_id: null })
  })

  it('binds the session when its work_report start succeeds, and traces it to the work item', () => {
    const state = foldState([INIT, { id: 'ev_s', at, type: 'session_registered', session_id: 's1', source: 'startup' }, STARTED])
    const outcome = handleHook(
      state,
      'PostToolUse',
      { session_id: 's1', tool_name: 'mcp__plugin_devops-drillmaster_drillmaster__work_report', tool_input: { action: 'start', issue: '#12' }, tool_response: startResponse },
      false,
    )
    expect(outcome.events).toEqual([
      { type: 'session_bound', session_id: 's1', work_item_id: 'wi_1' },
      expect.objectContaining({ type: 'work_trace', work_item_id: 'wi_1', error: false }),
    ])
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
})

describe('recorded payloads from a real Claude Code session', () => {
  it('binds the session from the real work_report start response', async () => {
    const { readFile } = await import('node:fs/promises')
    const fixture = JSON.parse(
      await readFile(new URL('../hooks/fixtures/recorded-posttooluse-work_report.json', import.meta.url), 'utf8'),
    ) as { payload: Record<string, unknown> }
    const id = startedWorkItem({ ...fixture.payload, hook_event_name: 'PostToolUse' })
    expect(id).toMatch(/^wi_/)
    const state = foldState([INIT, { ...STARTED, work_item_id: id! }])
    const outcome = handleHook(state, 'PostToolUse', fixture.payload, false)
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'session_bound', work_item_id: id }))
  })
})

describe('hook helpers', () => {
  it('finds the work item only in a successful work_report start', () => {
    const base = { hook_event_name: 'PostToolUse', tool_name: 'work_report', tool_input: { action: 'start' } }
    expect(startedWorkItem({ ...base, tool_response: startResponse })).toBe('wi_1')
    expect(startedWorkItem({ ...base, tool_response: { work_item_id: 'wi_7' } })).toBe('wi_7')
    expect(startedWorkItem({ ...base, tool_input: { action: 'report' }, tool_response: startResponse })).toBeUndefined()
    expect(startedWorkItem({ ...base, tool_name: 'Bash', tool_response: startResponse })).toBeUndefined()
  })

  it('redacts tokens in objects and in JSON text', () => {
    expect(redact({ token: 'abc', nested: { agent_token: 'def', n: 1 } })).toEqual({ token: '[redacted]', nested: { agent_token: '[redacted]', n: 1 } })
    expect(redact(JSON.stringify({ agent_token: 'abc' }, null, 2))).not.toContain('abc')
    expect(redact(JSON.stringify(JSON.stringify({ token: 'abc' })))).not.toContain('abc')
  })

  it('keeps tool inputs short', () => {
    expect(summarize('x'.repeat(600))).toHaveLength(503)
    expect(summarize(undefined)).toBeUndefined()
  })
})
