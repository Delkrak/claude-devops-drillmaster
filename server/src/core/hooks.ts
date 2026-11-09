import type { NewEvent } from './events.js'
import { decideProposals } from './owner.js'
import { decideOwnerAnswers, decideOwnerQuestion, pendingOwnerQuestions, type AnswerOutcome } from './questions.js'
import type { ProjectState, WorkItemState } from './state.js'

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
  if (typeof payload.tool_use_id === 'string') trace.tool_use_id = payload.tool_use_id
  events.push(trace)

  if (payload.tool_name === ASK_USER_QUESTION) {
    const asked = handleAskUserQuestion(state, hookEvent, sessionId, payload)
    events.push(...asked.events)
    if (asked.output) return { events, output: asked.output }
  }
  if (hookEvent === 'UserPromptSubmit' && typeof payload.prompt === 'string') {
    const typed = decideTypedPrompt(state, item, payload.prompt)
    if (typed.events.length) {
      events.push(...typed.events)
      return { events, output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `Drillmaster: ${typed.lines.join(' ')}` } } }
    }
  }
  return { events, output: hookEvent === 'SessionStart' ? briefSession(state, item) : undefined }
}

const ASK_USER_QUESTION = 'AskUserQuestion'

interface AskUserQuestionInput {
  questions?: { question?: unknown }[]
  answers?: Record<string, unknown>
}

/**
 * Owner's answers count only for a call PreToolUse saw without answers, so Agent can't answer for
 * Owner by filling them in. A missed PreToolUse leaves the decision pending.
 */
function handleAskUserQuestion(state: ProjectState, hookEvent: string, sessionId: string, payload: HookPayload): { events: NewEvent[]; output?: Record<string, unknown> } {
  const pendingQuestionTexts = new Set(pendingOwnerQuestions(state).map((question) => question.question))
  const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : undefined
  const input = (payload.tool_input ?? {}) as AskUserQuestionInput
  if (hookEvent === 'PreToolUse') {
    const askedTexts = (input.questions ?? []).map((question) => question.question).filter((text): text is string => typeof text === 'string' && pendingQuestionTexts.has(text))
    if (askedTexts.length === 0 || !toolUseId) return { events: [] }
    if (Object.keys(input.answers ?? {}).some((text) => pendingQuestionTexts.has(text))) {
      return {
        events: [],
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: "Drillmaster: Owner answers this question, not you. Ask it again without `answers`.",
          },
        },
      }
    }
    return { events: [{ type: 'owner_asked', session_id: sessionId, tool_use_id: toolUseId, questions: askedTexts }] }
  }
  if (hookEvent !== 'PostToolUse' || !toolUseId) return { events: [] }
  const askedTexts = state.ownerAsked[toolUseId]
  if (!askedTexts) return { events: [] }
  const response = (payload.tool_response ?? {}) as { answers?: Record<string, unknown>; annotations?: Record<string, unknown> }
  const answersToAsked = Object.fromEntries(Object.entries(response.answers ?? {}).filter(([text]) => askedTexts.includes(text)))
  const decided = decideOwnerAnswers(state, answersToAsked, response.annotations ?? {}, 'question')
  if (decided.lines.length === 0) return { events: [] }
  return { events: decided.events, output: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Drillmaster: ${decided.lines.join(' ')}` } } }
}

/** Owner's typed words decide a pending Owner gate, or the open proposals by number. Anything unclear is just a prompt. */
function decideTypedPrompt(state: ProjectState, item: WorkItemState | undefined, prompt: string): AnswerOutcome {
  const gateQuestion = pendingOwnerQuestions(state).find((question) => question.kind === 'owner_gate' && question.work_item_id === item?.work_item_id)
  if (gateQuestion) {
    const decided = decideOwnerQuestion(state, gateQuestion, { answer: prompt }, 'prompt')
    return decided.events.length ? decided : { events: [], lines: [] }
  }
  return decideRetroProposals(state, prompt)
}

function decideRetroProposals(state: ProjectState, prompt: string): AnswerOutcome {
  const none = { events: [], lines: [] }
  if (!state.latestRetroId) return none
  const retro = state.retros[state.latestRetroId]!
  const decidedIds = [...retro.approved, ...retro.declined, ...retro.applied]
  const openProposalIds = retro.proposals.map((proposal) => proposal.id).filter((id) => !decidedIds.includes(id))
  const decision = decideProposals(prompt, openProposalIds)
  if (!decision || (decision.approved.length === 0 && decision.declined.length === 0)) return none
  return {
    events: [{ type: 'owner_decided', retro_id: retro.retro_id, ...decision, prompt, via: 'prompt' }],
    lines: [
      decision.approved.length ? `Owner approved proposal ${decision.approved.join(', ')}: apply them with workflow_retrospective (action "apply").` : '',
      decision.declined.length ? `Owner declined proposal ${decision.declined.join(', ')}.` : '',
    ].filter(Boolean),
  }
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
  const ownerQuestions = pendingOwnerQuestions(state)
  if (ownerQuestions.length) {
    lines.push(`Owner has ${ownerQuestions.length} question${ownerQuestions.length > 1 ? 's' : ''} to answer. work_status shows the AskUserQuestion input to ask with.`)
  }
  if (workflow.stages.length === 0) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will correct you. The workflow grows from those corrections.')
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }
}
