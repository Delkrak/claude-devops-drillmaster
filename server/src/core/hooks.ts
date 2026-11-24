import type { NewEvent } from './events.js'
import { decideOwnerAnswers, pendingOwnerQuestions, type OwnerQuestion } from './questions.js'
import type { ProjectState, WorkItemState } from './state.js'
import { captureToolOutput } from './toolCapture.js'
import { atStep, workflowOfWorkItem } from './work.js'

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

/** PostToolUseFailure is how Claude Code reports a tool call that failed, such as a red test run, instead of PostToolUse. */
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStop'] as const

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

/** What Claude Code appends to a shell command's output when the command changed directory. */
const CLAUDE_CODE_CWD_NOTE = /\s*Shell cwd was reset to [^\n]*\s*$/

/** What a tool printed, without the notes Claude Code adds to it. */
export const toolOutputText = (toolResponse: unknown) => toolResponseText(toolResponse)?.replace(CLAUDE_CODE_CWD_NOTE, '')

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

/** The work item a work_start or work_resume call took up, which binds the session to it. */
export function takenUpWorkItemId(payload: HookPayload): string | undefined {
  const takesUp = isDrillmasterTool(payload.tool_name, 'work_start') || isDrillmasterTool(payload.tool_name, 'work_resume')
  if (payload.hook_event_name !== 'PostToolUse' || !takesUp) return undefined
  const match = /work_item_id\\?"?\s*:\s*\\?"?([A-Za-z0-9_-]+)/.exec(JSON.stringify(payload.tool_response ?? ''))
  return match?.[1]
}

function toolResponseIsError(toolResponse: unknown) {
  if (!toolResponse || typeof toolResponse !== 'object') return false
  const { isError, is_error, error, success } = toolResponse as { isError?: unknown; is_error?: unknown; error?: unknown; success?: unknown }
  return isError === true || is_error === true || (error !== undefined && error !== null) || success === false
}

export interface HookContext {
  /** Why a workflow retrospective is due, if it is. */
  retrospectiveDue?: string | null
  /** Why the last push to the Drillmaster repository failed, if it did. */
  repositoryProblem?: string
}

export function handleHook(state: ProjectState, hookEvent: string, payload: HookPayload, recordRaw: boolean, context: HookContext = {}): HookOutcome {
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
  const takenUpId = takenUpWorkItemId({ ...payload, hook_event_name: hookEvent })
  if (takenUpId && state.workItems[takenUpId]) {
    events.push({ type: 'session_bound', session_id: sessionId, work_item_id: takenUpId })
    workItemId = takenUpId
  }
  const item = workItemId ? state.workItems[workItemId] : undefined

  const trace: NewEvent = {
    type: 'work_trace',
    session_id: sessionId,
    work_item_id: workItemId,
    ...(item ? atStep(workflowOfWorkItem(state, item), item.stage, item.step) : { stage: null, step: null }),
    hook: hookEvent,
  }
  if (payload.tool_name) {
    trace.tool = payload.tool_name
    trace.input = truncateForTrace(redactTokens(payload.tool_input))
  }
  if (hookEvent === 'PostToolUse' || hookEvent === 'PostToolUseFailure') {
    const failed = hookEvent === 'PostToolUseFailure'
    const response = failed ? (payload.error ?? payload.tool_response) : payload.tool_response
    const exitCode = exitCodeOf(response)
    trace.error = failed || toolResponseIsError(response) || (exitCode !== undefined && exitCode !== 0)
    if (exitCode !== undefined) trace.exit_code = exitCode
    const workflow = item ? workflowOfWorkItem(state, item) : state.workflow
    const captured = captureToolOutput(workflow, payload.tool_name, payload.tool_input, toolOutputText(response), (text) => redactTokens(text) as string)
    if (captured?.captures.length) trace.captures = captured.captures
    if (captured?.foundNothing.length) trace.capture_found_nothing = captured.foundNothing
    if (captured?.mayBeShortened) trace.output_may_be_shortened = true
    if (!captured?.captures.length) {
      const output = outputTailForTrace(redactTokens(response))
      if (output) trace.output = output
    }
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
  return { events, output: hookEvent === 'SessionStart' ? briefSession(state, item, context) : undefined }
}

const ASK_USER_QUESTION = 'AskUserQuestion'

interface AskUserQuestionInput {
  questions?: { question?: unknown; header?: unknown; options?: { label?: unknown; description?: unknown; preview?: unknown }[] }[]
  answers?: Record<string, unknown>
}

const denyAsk = (reason: string) => ({
  events: [],
  output: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Drillmaster: ${reason}` } },
})

/**
 * What differs between a question Agent asks and Drillmaster's pending question it stands for: one
 * with the text or the header of a pending question. Owner must see Drillmaster's question as it is.
 */
/**
 * `ofThisSession` are the pending questions of the session's own work item, and those of no work
 * item, such as proposals: a header stands for one of those only, so Agent's own questions with the
 * header of another work item's question pass.
 */
function changesToPendingQuestions(asked: NonNullable<AskUserQuestionInput['questions']>, pending: readonly OwnerQuestion[], ofThisSession: readonly OwnerQuestion[]): string[] {
  return asked.flatMap((question) => {
    const sameText = pending.find((candidate) => candidate.question === question.question)
    const sameHeader = ofThisSession.filter((candidate) => candidate.header === question.header)
    if (!sameText && sameHeader.length === 0) return []
    if (!sameText) return [`the question with header "${String(question.header)}" is not one Drillmaster asks; ask ${sameHeader.map((candidate) => `"${candidate.question}"`).join(' or ')} word for word`]
    const options = question.options ?? []
    const optionChanges = sameText.options.flatMap((expected, index) => {
      const given = options[index]
      if (!given || given.label !== expected.label) return [`option ${index + 1} must be "${expected.label}"`]
      return [
        ...(given.description !== expected.description ? [`option "${expected.label}" has another description`] : []),
        ...((given.preview ?? undefined) !== expected.preview ? [`option "${expected.label}" ${given.preview === undefined ? 'is missing its preview' : 'has another preview'}`] : []),
      ]
    })
    const extra = options.length > sameText.options.length ? [`it has ${options.length - sameText.options.length} option(s) too many`] : []
    return [...optionChanges, ...extra].map((change) => `in "${sameText.question.slice(0, 80)}", ${change}`)
  })
}

/**
 * Owner's answers count only for a call PreToolUse saw without answers, so Agent can't answer for
 * Owner by filling them in. A missed PreToolUse leaves the decision pending.
 */
function handleAskUserQuestion(state: ProjectState, hookEvent: string, sessionId: string, payload: HookPayload): { events: NewEvent[]; output?: Record<string, unknown> } {
  const pendingQuestions = pendingOwnerQuestions(state)
  const pendingQuestionTexts = new Set(pendingQuestions.map((question) => question.question))
  const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : undefined
  const input = (payload.tool_input ?? {}) as AskUserQuestionInput
  if (hookEvent === 'PreToolUse') {
    const sessionItem = state.sessions[sessionId]?.work_item_id
    const ofThisSession = pendingQuestions.filter((question) => !('work_item_id' in question) || !sessionItem || question.work_item_id === sessionItem)
    const changes = changesToPendingQuestions(input.questions ?? [], pendingQuestions, ofThisSession)
    if (changes.length) return denyAsk(`Owner must see Drillmaster's question as it is, so this call is blocked: ${changes.join('; ')}. Pass ask_owner from the result (work_status shows it) exactly as it is.`)
    const askedTexts = (input.questions ?? []).map((question) => question.question).filter((text): text is string => typeof text === 'string' && pendingQuestionTexts.has(text))
    if (askedTexts.length === 0 || !toolUseId) return { events: [] }
    if (Object.keys(input.answers ?? {}).some((text) => pendingQuestionTexts.has(text))) return denyAsk('Owner answers this question, not you. Ask it again without `answers`.')
    return { events: [{ type: 'owner_asked', session_id: sessionId, tool_use_id: toolUseId, questions: askedTexts }] }
  }
  if (hookEvent !== 'PostToolUse' || !toolUseId) return { events: [] }
  const askedTexts = state.ownerAsked[toolUseId]
  if (!askedTexts) return { events: [] }
  const response = (payload.tool_response ?? {}) as { answers?: Record<string, unknown>; annotations?: Record<string, unknown> }
  const answersToAsked = Object.fromEntries(Object.entries(response.answers ?? {}).filter(([text]) => askedTexts.includes(text)))
  const annotationsToAsked = Object.fromEntries(Object.entries(response.annotations ?? {}).filter(([text]) => askedTexts.includes(text)))
  const decided = decideOwnerAnswers(state, answersToAsked, annotationsToAsked)
  if (decided.lines.length === 0) return { events: [] }
  const askAgain = decided.askAgain ? ` The question to ask again, as it is: ${JSON.stringify(decided.askAgain)}` : ''
  return { events: decided.events, output: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Drillmaster: ${decided.lines.join(' ')}${askAgain}` } } }
}

function briefSession(state: ProjectState, item: WorkItemState | undefined, context: HookContext) {
  const workflow = state.workflow!
  const lines = [
    `Drillmaster runs this project (workflow version ${workflow.version}). Owner's objective: "${workflow.objective.text}".`,
    'Every action you take is recorded in the work traces. Load the /devops-drillmaster:concept skill if any Drillmaster term is unclear.',
    item
      ? `You are on work item ${item.work_item_id} (${item.issue}), at ${item.stage === null ? 'no work stage yet' : `work step ${item.stage}.${item.step}`}.`
      : 'Start every work item with the work_start tool, or take up one from an earlier session with work_resume, and report to Drillmaster as you go. The /devops-drillmaster:work skill shows how.',
  ]
  if (item?.pending_gate) {
    lines.push(`The ${item.pending_gate.gate} gate of work step ${item.pending_gate.stage}.${item.pending_gate.step} is pending.`)
  }
  const ownerQuestions = pendingOwnerQuestions(state)
  if (ownerQuestions.length) {
    lines.push(`Owner has ${ownerQuestions.length} question${ownerQuestions.length > 1 ? 's' : ''} to answer. work_status shows the AskUserQuestion input to ask with.`)
  }
  lines.push("Owner decides gates and proposals only in AskUserQuestion. Owner's chat messages are instructions, never decisions; if one sounds like a decision, ask Owner the question.")
  if (context.repositoryProblem) {
    lines.push(`The Drillmaster repository could not be updated (${context.repositoryProblem}). Drillmaster keeps every event and tries again at the next stage end; tell Owner.`)
  }
  if (context.retrospectiveDue) {
    lines.push(`A workflow retrospective is due: ${context.retrospectiveDue}. Suggest it to Owner (/devops-drillmaster:retrospective); Owner decides when.`)
  }
  if (workflow.stages.length === 0) {
    lines.push('The workflow has no work stages yet: do your best, and Owner will step in where needed. The workflow grows from that.')
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }
}
