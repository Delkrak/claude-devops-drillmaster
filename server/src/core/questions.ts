import type { NewEvent } from './events.js'
import { resolveRef, stepGuidAt, stepPosition } from './refs.js'
import { questionKeyOf, type ProjectState, type WorkItemState } from './state.js'
import { atStep, decideSkip, describeMove, describeUpdate, inputEventsWithMove, moveOn, nextPosition, stepAt, workflowOfWorkItem } from './work.js'
import { AT_START, findRule, type WorkflowDocument, type WorkItemInput } from './workflow.js'

/** AskUserQuestion takes at most this many questions per call. */
export const MAX_QUESTIONS_PER_ASK = 4
const MAX_HEADER_LENGTH = 12
const MAX_QUOTED_ANSWER_LENGTH = 300

export const APPROVE = 'Approve'
export const REJECT = 'Reject'
export const DECLINE = 'Decline'

export interface QuestionOption {
  label: string
  description: string
  /** Markdown AskUserQuestion shows beside the options: what Owner decides on. */
  preview?: string
}

export type OwnerQuestion = {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: false
} & (
  | { kind: 'owner_gate'; work_item_id: string; stage: number; step: number }
  | { kind: 'proposal'; retro_id: string; proposal: number }
  | { kind: 'owner_input'; work_item_id: string; stage: number | null; step: number | null; input: string }
  | { kind: 'step_skip'; work_item_id: string; stage: number; step: number }
)

const header = (text: string) => text.slice(0, MAX_HEADER_LENGTH)

const bulletsOr = (lines: readonly string[], none: string) => (lines.length ? lines.map((line) => `- ${line}`) : [`- ${none}`])

/** What Owner approves at an Owner gate: Agent's report, the assumptions on the work item, and the rules. */
function ownerGatePreview(workflow: WorkflowDocument, item: WorkItemState, stage: number, stepNumber: number, report: string) {
  const step = stepAt(workflow, stage, stepNumber)
  const rules = (step?.rules ?? []).map((ruleRef) => {
    const rule = findRule(workflow, ruleRef)
    return rule ? `${ruleRef}: ${rule.rule} (verified by ${rule.verified_by})` : ruleRef
  })
  return [
    `## ${item.issue}: step ${stage}.${stepNumber} "${step?.name ?? ''}"`,
    ...(item.description ? ['', item.description] : []),
    '',
    '## What Agent reports',
    report.trim() || 'Nothing.',
    '',
    '## Assumptions Agent made',
    ...bulletsOr(item.assumptions, 'none'),
    '',
    '## The rules it must meet',
    ...bulletsOr(rules, 'none: judge it by what you want'),
  ].join('\n')
}

const withPreview = (options: QuestionOption[], preview: string) => options.map((option) => ({ ...option, preview }))


/** The preview with what Owner said on the question last time, so Owner sees it when asked again. */
const withOwnerComment = (preview: string, comment: string | undefined) => (comment ? `${preview}\n\n## Your note last time\n${comment}` : preview)

function ownerGateQuestion(state: ProjectState, item: WorkItemState): OwnerQuestion | undefined {
  const gate = item.pending_gate
  if (gate?.gate !== 'owner') return undefined
  const workflow = workflowOfWorkItem(state, item)
  const step = stepAt(workflow, gate.stage, gate.step)
  return {
    kind: 'owner_gate',
    work_item_id: item.work_item_id,
    stage: gate.stage,
    step: gate.step,
    question: `Owner gate of ${item.work_item_id} (${item.issue}), step ${gate.stage}.${gate.step} "${step?.name ?? ''}": is this what you want? What you approve is beside the options.`,
    header: 'Owner gate',
    options: withPreview(
      [
        { label: APPROVE, description: 'This is what you want: the work moves on. With a note, nothing is decided yet: Agent talks it through with you.' },
        { label: REJECT, description: 'It goes back. Say what to change in a note.' },
      ],
      withOwnerComment(ownerGatePreview(workflow, item, gate.stage, gate.step, gate.text), state.ownerComments[questionKeyOf({ kind: 'owner_gate', work_item_id: item.work_item_id, stage: gate.stage, step: gate.step })]),
    ),
    multiSelect: false,
  }
}

const MAX_QUOTED_JUSTIFICATION_LENGTH = 200

function stepSkipQuestion(state: ProjectState, item: WorkItemState): OwnerQuestion | undefined {
  const skip = item.pending_skip
  if (skip?.decided_by !== 'owner') return undefined
  const step = stepAt(workflowOfWorkItem(state, item), skip.stage, skip.step)
  const preview = [
    `## ${item.issue}: skip step ${skip.stage}.${skip.step} "${step?.name ?? ''}"?`,
    '',
    '## Why Agent wants to skip it',
    skip.why,
    '',
    '## What the step asks for',
    step?.instruction || 'No instruction.',
  ].join('\n')
  return {
    kind: 'step_skip',
    work_item_id: item.work_item_id,
    stage: skip.stage,
    step: skip.step,
    question: `Skip step ${skip.stage}.${skip.step} "${step?.name ?? ''}" of ${item.work_item_id} (${item.issue})? Agent says: ${quote(skip.why, MAX_QUOTED_JUSTIFICATION_LENGTH)}`,
    header: 'Skip step',
    options: withPreview(
      [
        { label: APPROVE, description: 'The step is not needed for this work item: it moves on. With a note, nothing is decided yet: Agent talks it through with you.' },
        { label: REJECT, description: 'Agent does the step. Say why in a note.' },
      ],
      withOwnerComment(preview, state.ownerComments[questionKeyOf({ kind: 'step_skip', work_item_id: item.work_item_id, stage: skip.stage, step: skip.step })]),
    ),
    multiSelect: false,
  }
}

function proposalQuestions(state: ProjectState): OwnerQuestion[] {
  const retro = state.latestRetroId ? state.retros[state.latestRetroId] : undefined
  if (!retro) return []
  const decided = new Set([...retro.approved, ...retro.declined, ...retro.applied])
  return retro.proposals
    .filter((proposal) => !decided.has(proposal.id))
    .map((proposal) => ({
      kind: 'proposal' as const,
      retro_id: retro.retro_id,
      proposal: proposal.id,
      question: `Proposal ${proposal.id} of ${retro.retro_id}: ${proposal.change}. Approve it?`,
      header: header(`Proposal ${proposal.id}`),
      options: withPreview(
        [
          { label: APPROVE, description: 'Apply it as a workflow experiment. With a note, nothing is decided yet: Agent talks it through with you.' },
          { label: DECLINE, description: 'Leave the workflow as it is. Say why in a note.' },
        ],
        withOwnerComment(proposalPreview(proposal), state.ownerComments[questionKeyOf({ kind: 'proposal', retro_id: retro.retro_id, proposal: proposal.id })]),
      ),
      multiSelect: false as const,
    }))
}

/** Owner's inputs of a work item that are due, set at work_start or at a step it passed, and not set yet. */
function proposalPreview(proposal: ProjectState['retros'][string]['proposals'][number]) {
  return [
    `## Proposal ${proposal.id}: ${proposal.change}`,
    '',
    '## Why',
    proposal.purpose || 'Not said.',
    '',
    '## What should happen',
    proposal.hypothesis || 'Not said.',
    ...(proposal.null_hypothesis ? ['', '## What would show it made no difference', proposal.null_hypothesis] : []),
    '',
    `## How it is judged`,
    `On ${proposal.measure}${proposal.target !== undefined && proposal.target !== null ? `, aiming for ${proposal.target}` : ''}, after ${proposal.judge_after ?? 3} delivered work items.`,
  ].join('\n')
}

function ownerInputQuestions(state: ProjectState, item: WorkItemState): OwnerQuestion[] {
  const workflow = workflowOfWorkItem(state, item)
  const done = new Set([...item.passed_step_guids, ...item.skipped_step_guids])
  const isDue = (input: WorkItemInput) => input.set_at === AT_START || done.has(resolveRef(workflow, input.set_at, { impliedKind: 'step' }).guid!)
  return workflow.inputs
    .filter((input) => input.by === 'owner' && !item.inputs[input.name] && isDue(input))
    .map((input) => ({
      kind: 'owner_input' as const,
      work_item_id: item.work_item_id,
      ...(input.set_at === AT_START ? { stage: null, step: null } : stepPosition(input.set_at)!),
      input: input.name,
      question: `Input "${input.name}" for ${item.work_item_id} (${item.issue}): ${input.instruction}`,
      header: header(input.name),
      options: withPreview(
        input.options.map((option) => ({ label: option.value, description: option.description })),
        [`## ${item.issue}: ${input.name}`, ...(item.description ? ['', item.description] : []), '', `## The question`, input.instruction].join('\n'),
      ),
      multiSelect: false as const,
    }))
}

export function pendingOwnerQuestions(state: ProjectState): OwnerQuestion[] {
  const items = Object.values(state.workItems)
  return [
    ...items.flatMap((item) => ownerGateQuestion(state, item) ?? []),
    ...items.flatMap((item) => stepSkipQuestion(state, item) ?? []),
    ...items.flatMap((item) => (item.status === 'active' ? ownerInputQuestions(state, item) : [])),
    ...proposalQuestions(state),
  ]
}

export const askUserQuestionInput = (questions: readonly OwnerQuestion[]) => ({
  questions: questions.slice(0, MAX_QUESTIONS_PER_ASK).map(({ question, header: questionHeader, options, multiSelect }) => ({ question, header: questionHeader, options, multiSelect })),
})

const quote = (text: string, maxLength = MAX_QUOTED_ANSWER_LENGTH) => (text.length > maxLength ? `${text.slice(0, maxLength)}...` : text)

export interface OwnerAnswer {
  answer: string
  notes?: string
}

export interface AnswerOutcome {
  events: NewEvent[]
  lines: string[]
}

type Approval = { decision: 'approved' } | { decision: 'rejected'; reason: string } | { decision: 'undecided'; comment: string }

/**
 * Approve with nothing added approves; Reject or Decline rejects, a note being the reason. Anything
 * else (a note on Approve, an answer Owner typed, a note alone) decides nothing: Owner has
 * something to say first.
 */
function readApproval(ownerAnswer: OwnerAnswer): Approval {
  const notes = ownerAnswer.notes ?? ''
  if (ownerAnswer.answer === APPROVE && !notes) return { decision: 'approved' }
  if (ownerAnswer.answer === REJECT || ownerAnswer.answer === DECLINE) return { decision: 'rejected', reason: notes }
  return { decision: 'undecided', comment: [ownerAnswer.answer === APPROVE ? '' : ownerAnswer.answer.trim(), notes].filter(Boolean).join(' - ') }
}

const QUESTION_SUBJECTS: Record<Exclude<OwnerQuestion['kind'], 'owner_input'>, (question: OwnerQuestion) => string> = {
  owner_gate: (question) => `the Owner gate of step ${'stage' in question ? `${question.stage}.${question.step}` : ''}`,
  step_skip: (question) => `skipping step ${'stage' in question ? `${question.stage}.${question.step}` : ''}`,
  proposal: (question) => `proposal ${'proposal' in question ? question.proposal : ''}`,
}

/** Owner's words on a question Owner did not decide: kept, so the question shows them when asked again. */
function leftUndecided(question: Exclude<OwnerQuestion, { kind: 'owner_input' }>, comment: string): AnswerOutcome {
  return {
    events: [{ type: 'owner_commented', question: questionKeyOf(question), ...('work_item_id' in question ? { work_item_id: question.work_item_id } : {}), comment }],
    lines: [
      `Owner did not decide ${QUESTION_SUBJECTS[question.kind](question)} and said: "${quote(comment)}". Talk it through with Owner; once Owner is ready, ask again with the question below, which shows Owner's note.`,
    ],
  }
}

export function decideOwnerQuestion(state: ProjectState, question: OwnerQuestion, ownerAnswer: OwnerAnswer): AnswerOutcome {
  switch (question.kind) {
    case 'owner_gate': {
      const approval = readApproval(ownerAnswer)
      if (approval.decision === 'undecided') return leftUndecided(question, approval.comment)
      const accepted = approval.decision === 'approved'
      const reason = approval.decision === 'rejected' ? approval.reason : ''
      const item = state.workItems[question.work_item_id]!
      const workflow = workflowOfWorkItem(state, item)
      const passed = accepted ? nextPosition(workflow, question.stage, question.step) : { next: { stage: question.stage, step: question.step }, done: false }
      const moved = accepted ? moveOn(state, item, workflow, passed, { doneNow: [stepGuidAt(workflow, question.stage, question.step)!] }) : undefined
      const rules = stepAt(workflow, question.stage, question.step)?.rules ?? []
      const stepLabel = `step ${question.stage}.${question.step}`
      return {
        events: [
          {
            type: 'gate_verdict',
            work_item_id: question.work_item_id,
            ...atStep(workflow, question.stage, question.step),
            accepted,
            by: 'owner',
            via: 'question',
            why: accepted ? 'Owner approved.' : `Owner rejected${reason ? `: "${quote(reason)}"` : '.'}`,
            rule: rules.length ? rules.join(', ') : null,
            ...passed,
          },
          ...(moved?.events ?? []),
        ],
        lines: [
          moved
            ? `Owner approved the Owner gate of ${stepLabel}. ${moved.update ? `${updateLine(describeUpdate(moved.update))} ` : ''}${nextLine(describeMove(moved))}`
            : `Owner rejected the Owner gate of ${stepLabel}${reason ? `: "${quote(reason)}"` : ''}. Do what Owner asks, report the impediment, and hand the gate in again.`,
        ],
      }
    }
    case 'proposal': {
      const approval = readApproval(ownerAnswer)
      if (approval.decision === 'undecided') return leftUndecided(question, approval.comment)
      const approved = approval.decision === 'approved'
      const reason = approval.decision === 'rejected' ? approval.reason : ''
      return {
        events: [
          {
            type: 'owner_decided',
            retro_id: question.retro_id,
            approved: approved ? [question.proposal] : [],
            declined: approved ? [] : [question.proposal],
            prompt: ownerAnswer.answer,
            via: 'question',
            ...(reason ? { comment: reason } : {}),
          },
        ],
        lines: [`Owner ${approved ? 'approved' : 'declined'} proposal ${question.proposal}${reason ? ` ("${quote(reason)}")` : ''}.`],
      }
    }
    case 'step_skip': {
      const approval = readApproval(ownerAnswer)
      if (approval.decision === 'undecided') return leftUndecided(question, approval.comment)
      const accepted = approval.decision === 'approved'
      const reason = approval.decision === 'rejected' ? approval.reason : ''
      const item = state.workItems[question.work_item_id]!
      const decided = decideSkip(state, item, { accepted, by: 'owner', via: 'question', why: accepted ? 'Owner approved.' : `Owner rejected${reason ? `: "${quote(reason)}"` : '.'}` })
      const move = decided.answer as MoveAnswer
      return {
        events: decided.events,
        lines: [
          accepted
            ? `Owner approved skipping step ${question.stage}.${question.step}. ${move.update ? `${updateLine(move.update)} ` : ''}${nextLine(move)}`
            : `Owner rejected skipping step ${question.stage}.${question.step}${reason ? `: "${quote(reason)}"` : ''}. Do the step.`,
        ],
      }
    }
    case 'owner_input': {
      const option = question.options.find((candidate) => candidate.label === ownerAnswer.answer)
      if (!option) {
        return { events: [], lines: [`Owner typed "${quote(ownerAnswer.answer)}" for input "${question.input}", which is none of its options, so it stays open. Ask again with the same question.`] }
      }
      const at = question.stage === null || question.step === null ? null : { stage: question.stage, step: question.step }
      const events = inputEventsWithMove(state, state.workItems[question.work_item_id]!, at, [
        { name: question.input, value: option.label, ...(ownerAnswer.notes ? { explanation: ownerAnswer.notes } : {}), by: 'owner' },
      ])
      return { events, lines: [`Owner set input "${question.input}": ${option.label}.`] }
    }
  }
}

type MoveAnswer = ReturnType<typeof describeMove> & { update?: Parameters<typeof updateLine>[0] }

const nextLine = (move: Pick<MoveAnswer, 'next' | 'done' | 'session_done' | 'waiting_for_inputs'>) =>
  move.done
    ? 'Every work gate has passed: deliver the work item.'
    : move.session_done
      ? `This session's stages are done: the work item waits at step ${move.next.stage}.${move.next.step}. Stop, and tell Owner; a later session takes it up with work_resume.`
      : move.waiting_for_inputs
        ? `Next: step ${move.next.stage}.${move.next.step}, which waits for input ${move.waiting_for_inputs.join(', ')} (work_status shows who sets it).`
        : `Next: step ${move.next.stage}.${move.next.step} (work_status shows it).`

const updateLine = (update: { from_version: string; to_version: string; kept: string[] }) =>
  `The work item updated from workflow ${update.from_version} to ${update.to_version}, keeping ${update.kept.length ? `step ${update.kept.join(', ')}` : 'no step'} as done.`

/**
 * Decides each question Owner answered, by its text; a note alone, with no option picked, is an
 * answer too. The questions Owner left undecided come back with Owner's words in their preview.
 */
export function decideOwnerAnswers(state: ProjectState, answers: Record<string, unknown>, annotations: Record<string, unknown>): AnswerOutcome & { askAgain?: ReturnType<typeof askUserQuestionInput> } {
  const pending = pendingOwnerQuestions(state)
  const outcome: AnswerOutcome = { events: [], lines: [] }
  const comments: Record<string, string> = {}
  for (const questionText of new Set([...Object.keys(answers), ...Object.keys(annotations)])) {
    const question = pending.find((candidate) => candidate.question === questionText)
    const answer = answers[questionText] ?? ''
    const notes = (annotations[questionText] as { notes?: unknown } | undefined)?.notes
    const trimmedNotes = typeof notes === 'string' ? notes.trim() : ''
    if (!question || typeof answer !== 'string' || (!answer.trim() && !trimmedNotes)) continue
    const decided = decideOwnerQuestion(state, question, { answer, ...(trimmedNotes ? { notes: trimmedNotes } : {}) })
    outcome.events.push(...decided.events)
    outcome.lines.push(...decided.lines)
    for (const event of decided.events) if (event.type === 'owner_commented') comments[event.question] = event.comment
  }
  if (Object.keys(comments).length === 0) return outcome
  const withComments = { ...state, ownerComments: { ...state.ownerComments, ...comments } }
  const askAgain = askUserQuestionInput(pendingOwnerQuestions(withComments).filter((question) => question.kind !== 'owner_input' && comments[questionKeyOf(question)] !== undefined))
  return { ...outcome, askAgain }
}
