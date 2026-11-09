import type { NewEvent } from './events.js'
import { classifyOwnerWords, decideProposals } from './owner.js'
import type { ProjectState, WorkItemState } from './state.js'
import { nextPosition, stepAt, workflowOfWorkItem } from './work.js'

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
  output?: Record<string, unknown>
}

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'] as const

const MAX_TRACED_INPUT_LENGTH = 2000
const MAX_TRACED_OUTPUT_LINES = 20
const MAX_TRACED_OUTPUT_LENGTH = 2000
const MAX_QUOTED_PROMPT_LENGTH = 300

const SECRET_KEY_NAME = /token/i
const SECRET_IN_JSON_TEXT = /(\\?"(?:agent_)?token\\?"\s*:\s*\\?")[^"\\]+/g
// Built in for now; these may become configurable regex rules per project.
const WELL_KNOWN_SECRETS: [RegExp, string][] = [
  [/(agent_token:\s*)[A-Za-z0-9_-]+/g, '$1[redacted]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\b(\w*(?:password|passwd|pwd|secret|api[_-]?key))(\s*[=:]\s*)("?)[^\s"',;]+/gi, '$1$2$3[redacted]'],
]

const redactSecretText = (text: string) =>
  WELL_KNOWN_SECRETS.reduce((redacted, [pattern, replacement]) => redacted.replace(pattern, replacement), text.replace(SECRET_IN_JSON_TEXT, '$1[redacted]'))

export function redactTokens(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretText(value)
  if (Array.isArray(value)) return value.map(redactTokens)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, SECRET_KEY_NAME.test(key) && typeof field === 'string' ? '[redacted]' : redactTokens(field)]),
    )
  }
  return value
}

export function truncateForTrace(value: unknown) {
  if (value === undefined) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_TRACED_INPUT_LENGTH ? `${text.slice(0, MAX_TRACED_INPUT_LENGTH)}...` : text
}

function toolResponseText(toolResponse: unknown): string | undefined {
  if (toolResponse === undefined || toolResponse === null) return undefined
  if (typeof toolResponse === 'string') return toolResponse
  if (Array.isArray(toolResponse)) {
    const texts = toolResponse.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : JSON.stringify(part)))
    return texts.join('\n')
  }
  if (typeof toolResponse === 'object') {
    const { stdout, stderr, content, error } = toolResponse as { stdout?: unknown; stderr?: unknown; content?: unknown; error?: unknown }
    const streams = [stdout, stderr].filter((stream): stream is string => typeof stream === 'string' && stream !== '')
    if (streams.length) return streams.join('\n')
    if (typeof error === 'string') return error
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return toolResponseText(content)
  }
  return JSON.stringify(toolResponse)
}

export function outputTailForTrace(toolResponse: unknown) {
  const text = toolResponseText(toolResponse)
  if (!text?.trim()) return undefined
  const tail = text.trimEnd().split(/\r?\n/).slice(-MAX_TRACED_OUTPUT_LINES).join('\n')
  const capped = tail.length > MAX_TRACED_OUTPUT_LENGTH ? `...${tail.slice(-MAX_TRACED_OUTPUT_LENGTH)}` : tail
  return redactSecretText(capped)
}

export function exitCodeOf(toolResponse: unknown): number | undefined {
  if (!toolResponse || typeof toolResponse !== 'object') return undefined
  const { exit_code, exitCode, returnCode, code } = toolResponse as Record<string, unknown>
  const found = [exit_code, exitCode, returnCode, code].find((candidate) => typeof candidate === 'number')
  return found as number | undefined
}

export const isDrillmasterTool = (toolName: string | undefined, name: string) => toolName === name || (toolName?.endsWith(`__${name}`) ?? false)

export function startedWorkItemId(payload: HookPayload): string | undefined {
  if (payload.hook_event_name !== 'PostToolUse' || !isDrillmasterTool(payload.tool_name, 'work_start')) return undefined
  const match = /work_item_id\\?"?\s*:\s*\\?"?([A-Za-z0-9_-]+)/.exec(JSON.stringify(payload.tool_response ?? ''))
  return match?.[1]
}

function toolResponseIsError(toolResponse: unknown) {
  if (!toolResponse || typeof toolResponse !== 'object') return false
  const { isError, is_error, error, success } = toolResponse as { isError?: unknown; is_error?: unknown; error?: unknown; success?: unknown }
  return isError === true || is_error === true || (error !== undefined && error !== null) || success === false
}

export function handleHook(state: ProjectState, hookEvent: string, payload: HookPayload, recordRaw: boolean): HookOutcome {
  if (!state.initialized || !state.workflow) return { events: [] }
  const sessionId = payload.session_id
  if (!sessionId) return { events: [] }

  const events: NewEvent[] = []
  const knownSession = state.sessions[sessionId]
  if (!knownSession) {
    events.push({ type: 'session_registered', session_id: sessionId, source: hookEvent === 'SessionStart' ? (payload.source ?? 'startup') : 'implicit' })
  }

  // Binding comes first, so this PostToolUse trace already belongs to the new work item.
  let workItemId = knownSession?.work_item_id ?? null
  const startedId = startedWorkItemId({ ...payload, hook_event_name: hookEvent })
  if (startedId && state.workItems[startedId]) {
    events.push({ type: 'session_bound', session_id: sessionId, work_item_id: startedId })
    workItemId = startedId
  }
  const item = workItemId ? state.workItems[workItemId] : undefined

  const trace: NewEvent = {
    type: 'work_trace',
    session_id: sessionId,
    work_item_id: workItemId,
    stage: item?.stage ?? null,
    step: item?.step ?? null,
    hook: hookEvent,
  }
  if (payload.tool_name) {
    trace.tool = payload.tool_name
    trace.input = truncateForTrace(redactTokens(payload.tool_input))
  }
  if (hookEvent === 'PostToolUse') {
    const exitCode = exitCodeOf(payload.tool_response)
    trace.error = toolResponseIsError(payload.tool_response) || (exitCode !== undefined && exitCode !== 0)
    if (exitCode !== undefined) trace.exit_code = exitCode
    const output = outputTailForTrace(redactTokens(payload.tool_response))
    if (output) trace.output = output
  }
  if (hookEvent === 'UserPromptSubmit' && typeof payload.prompt === 'string') trace.prompt = payload.prompt
  if (recordRaw) trace.raw = redactTokens(payload)
  events.push(trace)

  if (hookEvent === 'UserPromptSubmit' && typeof payload.prompt === 'string') {
    const ownerDecision = item?.pending_gate?.gate === 'owner' ? decideOwnerGate(state, item, payload.prompt) : decideRetroProposals(state, payload.prompt)
    if (ownerDecision) {
      events.push(ownerDecision.event)
      return { events, output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ownerDecision.context } } }
    }
  }
  return { events, output: hookEvent === 'SessionStart' ? briefSession(state, item) : undefined }
}

function decideOwnerGate(state: ProjectState, item: WorkItemState, prompt: string) {
  const gate = item.pending_gate!
  const classification = classifyOwnerWords(prompt)
  if (classification === 'unclear') return undefined
  const workflow = workflowOfWorkItem(state, item)
  const rules = stepAt(workflow, gate.stage, gate.step)?.rules ?? []
  const accepted = classification === 'approve'
  const position = accepted ? nextPosition(workflow, gate.stage, gate.step) : { next: { stage: gate.stage, step: gate.step }, done: false }
  const quotedPrompt = prompt.length > MAX_QUOTED_PROMPT_LENGTH ? `${prompt.slice(0, MAX_QUOTED_PROMPT_LENGTH)}...` : prompt
  const event: NewEvent = {
    type: 'gate_verdict',
    work_item_id: item.work_item_id,
    stage: gate.stage,
    step: gate.step,
    accepted,
    by: 'owner',
    why: `Owner: "${quotedPrompt}"`,
    rule: rules.length ? rules.join(', ') : null,
    ...position,
  }
  const stepLabel = `work step ${gate.stage}.${gate.step}`
  const context = accepted
    ? `Drillmaster: Owner approved the Owner gate of ${stepLabel}. ${position.done ? 'Every work gate has passed: deliver the work item.' : `Next: work step ${position.next.stage}.${position.next.step}.`}`
    : `Drillmaster: Owner rejected the Owner gate of ${stepLabel}. Do what Owner asks, report the impediment, and hand the gate in again.`
  return { event, context }
}

function decideRetroProposals(state: ProjectState, prompt: string) {
  if (!state.latestRetroId) return undefined
  const retro = state.retros[state.latestRetroId]!
  const decidedIds = [...retro.approved, ...retro.declined, ...retro.applied]
  const openProposalIds = retro.proposals.map((proposal) => proposal.id).filter((id) => !decidedIds.includes(id))
  const decision = decideProposals(prompt, openProposalIds)
  if (!decision || (decision.approved.length === 0 && decision.declined.length === 0)) return undefined
  const event: NewEvent = { type: 'owner_decided', retro_id: retro.retro_id, ...decision, prompt }
  const contextParts = [
    decision.approved.length ? `Owner approved proposal ${decision.approved.join(', ')}: apply each with workflow_retrospective (action "apply").` : '',
    decision.declined.length ? `Owner declined proposal ${decision.declined.join(', ')}.` : '',
  ].filter(Boolean)
  return { event, context: `Drillmaster: ${contextParts.join(' ')}` }
}

function briefSession(state: ProjectState, item: WorkItemState | undefined) {
  const workflow = state.workflow!
  const lines = [
    `Drillmaster runs this project (workflow version ${workflow.version}). Owner's objective: "${workflow.objective.text}".`,
    'Every action you take is recorded in the work traces. Load the /devops-drillmaster:concept skill if any Drillmaster term is unclear.',
    item
      ? `You are on work item ${item.work_item_id} (${item.issue}), at ${item.stage === null ? 'no work stage yet' : `work step ${item.stage}.${item.step}`}.`
      : 'Start every work item with the work_start tool, and report to Drillmaster as you go. The /devops-drillmaster:work skill shows how.',
  ]
  if (item?.pending_gate) {
    lines.push(`The ${item.pending_gate.gate} gate of work step ${item.pending_gate.stage}.${item.pending_gate.step} is pending.`)
  }
  if (workflow.stages.length === 0) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will correct you. The workflow grows from those corrections.')
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }
}
