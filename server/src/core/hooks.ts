// What a Claude Code hook payload means for Drillmaster. Pure: state and payload in, the events to
// append and the hook's output out. The server only stores and replies.

import type { NewEvent } from './events.js'
import type { ProjectState, WorkItemState } from './state.js'
import { nextPosition, stepAt, workflowOf } from './work.js'

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

const SECRET_KEY = /token/i
const SECRET_IN_TEXT = /(\\?"(?:agent_)?token\\?"\s*:\s*\\?")[^"\\]+/g

/** Agent's token never reaches the store: not in tool inputs, responses or recorded payloads. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_IN_TEXT, '$1[redacted]')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) && typeof v === 'string' ? '[redacted]' : redact(v)]))
  }
  return value
}

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
    trace.input = summarize(redact(payload.tool_input))
  }
  if (event === 'PostToolUse') trace.error = toolFailed(payload.tool_response)
  if (event === 'UserPromptSubmit' && typeof payload.prompt === 'string') trace.prompt = payload.prompt
  if (record) trace.raw = redact(payload)
  events.push(trace)

  if (event === 'UserPromptSubmit' && item?.pending_gate?.gate === 'owner' && typeof payload.prompt === 'string') {
    const owner = ownerVerdict(state, item, payload.prompt)
    if (owner) {
      events.push(owner.event)
      return { events, output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: owner.context } } }
    }
  }
  return { events, output: event === 'SessionStart' ? sessionBrief(state, item) : undefined }
}

const REJECT = /\b(no|nope|don'?t|do not|reject(ed)?|not (yet|ok|okay|good|approved|done)|wait|stop|wrong|redo|fix|change|nej|vent)\b/i
const APPROVE = /\b(yes|yep|yeah|ok|okay|approved?|lgtm|looks good|go ahead|ship it|merge it|accept(ed)?|fine|good|great|ja|godkendt|fint)\b/i

/** v1: any direct agreement Owner writes to Agent is enough. A rejection word wins; unclear waits. */
export function classifyOwner(prompt: string): 'approve' | 'reject' | 'unclear' {
  if (REJECT.test(prompt)) return 'reject'
  if (APPROVE.test(prompt)) return 'approve'
  return 'unclear'
}

function ownerVerdict(state: ProjectState, item: WorkItemState, prompt: string) {
  const gate = item.pending_gate!
  const verdict = classifyOwner(prompt)
  if (verdict === 'unclear') return undefined
  const doc = workflowOf(state, item)
  const rules = stepAt(doc, gate.stage, gate.step)?.rules ?? []
  const accepted = verdict === 'approve'
  const position = accepted ? nextPosition(doc, gate.stage, gate.step) : { next: { stage: gate.stage, step: gate.step }, done: false }
  const event: NewEvent = {
    type: 'gate_verdict',
    work_item_id: item.work_item_id,
    stage: gate.stage,
    step: gate.step,
    accepted,
    by: 'owner',
    why: `Owner: "${prompt.length > 300 ? `${prompt.slice(0, 300)}...` : prompt}"`,
    rule: rules.length ? rules.join(', ') : null,
    ...position,
  }
  const where = `work step ${gate.stage}.${gate.step}`
  const context = accepted
    ? `Drillmaster: Owner approved the Owner gate of ${where}. ${position.done ? 'Every work gate has passed: deliver the work item.' : `Next: work step ${position.next.stage}.${position.next.step}.`}`
    : `Drillmaster: Owner rejected the Owner gate of ${where}. Do what Owner asks, report the impediment, and hand the gate in again.`
  return { event, context }
}

function sessionBrief(state: ProjectState, item: ProjectState['workItems'][string] | undefined) {
  const workflow = state.workflow!
  const lines = [
    `Drillmaster runs this project (workflow version ${workflow.version}). Owner's objective: "${workflow.objective.text}".`,
    'Every action you take is recorded in the work traces. Load the /devops-drillmaster:concept skill if any Drillmaster term is unclear.',
    item
      ? `You are on work item ${item.work_item_id} (${item.issue}), at ${item.stage === null ? 'no work stage yet' : `work step ${item.stage}.${item.step}`}.`
      : 'Start every work item with the work_report tool (action "start"), and report to Drillmaster as you go. The /devops-drillmaster:work skill shows how.',
  ]
  if (item?.pending_gate) {
    lines.push(`The ${item.pending_gate.gate} gate of work step ${item.pending_gate.stage}.${item.pending_gate.step} is pending.`)
  }
  if (workflow.stages.length === 0) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will correct you. The workflow grows from those corrections.')
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }
}
