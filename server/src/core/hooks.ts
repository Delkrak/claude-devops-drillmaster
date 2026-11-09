// What a Claude Code hook payload means for Drillmaster. Pure: state and payload in, the events to
// append and the hook's output out. The server only stores and replies.

import type { NewEvent } from './events.js'
import type { ProjectState } from './state.js'

/** The fields Drillmaster reads from a Claude Code hook payload. Anything else is ignored. */
export interface HookPayload {
  session_id?: string
  hook_event_name?: string
  source?: string
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
  prompt?: string
  [key: string]: unknown
}

export interface HookOutcome {
  events: NewEvent[]
  /** JSON the hook prints to stdout for Claude Code, if any. */
  output?: Record<string, unknown>
}

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'] as const

const MAX_INPUT = 500

/** A short, single-line view of a tool input, so traces stay small. */
export function summarize(value: unknown) {
  if (value === undefined) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_INPUT ? `${text.slice(0, MAX_INPUT)}...` : text
}

/** Drillmaster's own work_report tool, whatever prefix Claude Code gives MCP tools. */
const isWorkReport = (tool?: string) => tool === 'work_report' || (tool?.endsWith('__work_report') ?? false)

/** The work item id from a successful work_report(start) response. */
export function startedWorkItem(payload: HookPayload): string | undefined {
  if (payload.hook_event_name !== 'PostToolUse' || !isWorkReport(payload.tool_name)) return undefined
  const input = payload.tool_input as { action?: string } | undefined
  if (input?.action !== 'start') return undefined
  const match = /\\?"work_item_id\\?"\s*:\s*\\?"([^"\\]+)\\?"/.exec(JSON.stringify(payload.tool_response ?? ''))
  return match?.[1]
}

function toolFailed(response: unknown) {
  if (response && typeof response === 'object') {
    const r = response as { isError?: unknown; is_error?: unknown; error?: unknown; success?: unknown }
    return r.isError === true || r.is_error === true || (r.error !== undefined && r.error !== null) || r.success === false
  }
  return false
}

export function handleHook(state: ProjectState, event: string, payload: HookPayload, record: boolean): HookOutcome {
  // A project without a workflow doesn't use Drillmaster: nothing is stored, nothing is said.
  if (!state.initialized || !state.workflow) return { events: [] }
  const sessionId = payload.session_id
  if (!sessionId) return { events: [] }

  const events: NewEvent[] = []
  const known = state.sessions[sessionId]
  if (!known) {
    events.push({ type: 'session_registered', session_id: sessionId, source: event === 'SessionStart' ? (payload.source ?? 'startup') : 'implicit' })
  }

  // Binding comes first, so this PostToolUse trace already belongs to the new work item.
  let workItemId = known?.work_item_id ?? null
  const started = startedWorkItem({ ...payload, hook_event_name: event })
  if (started && state.workItems[started]) {
    events.push({ type: 'session_bound', session_id: sessionId, work_item_id: started })
    workItemId = started
  }
  const item = workItemId ? state.workItems[workItemId] : undefined

  const trace: NewEvent = {
    type: 'work_trace',
    session_id: sessionId,
    work_item_id: workItemId,
    stage: item?.stage ?? null,
    step: item?.step ?? null,
    hook: event,
  }
  if (payload.tool_name) {
    trace.tool = payload.tool_name
    trace.input = summarize(payload.tool_input)
  }
  if (event === 'PostToolUse') trace.error = toolFailed(payload.tool_response)
  if (event === 'UserPromptSubmit' && typeof payload.prompt === 'string') trace.prompt = payload.prompt
  if (record) trace.raw = payload
  events.push(trace)

  return { events, output: event === 'SessionStart' ? sessionBrief(state, item) : undefined }
}

function sessionBrief(state: ProjectState, item: ProjectState['workItems'][string] | undefined) {
  const workflow = state.workflow!
  const lines = [
    `Drillmaster runs this project (workflow version ${workflow.version}). Owner's objective: "${workflow.objective.text}".`,
    'Every action you take is recorded in the work traces. Load the /devops-drillmaster:concept skill if any Drillmaster term is unclear.',
    item
      ? `You are on work item ${item.work_item_id} (${item.issue}), at ${item.stage === null ? 'no work stage yet' : `work step ${item.stage}.${item.step}`}.`
      : 'Start every work item with the work_report tool (action "start"), and report to Drillmaster as you go.',
  ]
  if (workflow.stages.length === 0) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will correct you. The workflow grows from those corrections.')
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }
}
