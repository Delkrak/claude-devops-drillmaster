import type { NewEvent } from './events.js'
import { classifyOwnerWords, decideProposals } from './owner.js'
import type { ProjectState, WorkItemState } from './state.js'
import { nextPosition, stepAt, workflowOfWorkItem } from './work.js'
import type { WorkflowMetric } from './workflow.js'

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
}

export type OwnerQuestion = {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: false
} & (
  | { kind: 'owner_gate'; work_item_id: string; stage: number; step: number }
  | { kind: 'proposal'; retro_id: string; proposal: number }
  | { kind: 'owner_metric'; work_item_id: string; stage: number; step: number; metric: string }
  | { kind: 'gate_skip'; work_item_id: string }
)

const header = (text: string) => text.slice(0, MAX_HEADER_LENGTH)

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
    question: `Owner gate of ${item.work_item_id} (${item.issue}), work step ${gate.stage}.${gate.step} "${step?.name ?? ''}": does the work meet ${step?.rules.length ? step.rules.join(', ') : 'what you expect'}?`,
    header: 'Owner gate',
    options: [
      { label: APPROVE, description: 'The work meets the rules: it moves on.' },
      { label: REJECT, description: 'It goes back. Say what to fix in a note.' },
    ],
    multiSelect: false,
  }
}

const MAX_QUOTED_JUSTIFICATION_LENGTH = 200

function gateSkipQuestion(item: WorkItemState): OwnerQuestion | undefined {
  const lateStart = item.late_start
  if (lateStart?.status !== 'awaiting_owner') return undefined
  const startAt = `${lateStart.start_at.stage}.${lateStart.start_at.step}`
  return {
    kind: 'gate_skip',
    work_item_id: item.work_item_id,
    question: `Start ${item.work_item_id} (${item.issue}) at work step ${startAt}, skipping ${lateStart.skipped.join(', ')} and your Owner gate of ${lateStart.owner_gates.join(', ')}? Agent says: ${quote(lateStart.justification, MAX_QUOTED_JUSTIFICATION_LENGTH)}`,
    header: 'Skip gate',
    options: [
      { label: APPROVE, description: `Drillmaster found the earlier work meets the rules. The work starts at ${startAt}.` },
      { label: REJECT, description: 'The work starts at the first work step.' },
    ],
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
      options: [
        { label: APPROVE, description: `${proposal.purpose}${proposal.hypothesis ? ` Hypothesis: ${proposal.hypothesis}` : ''}`.trim() || 'Apply it as a workflow experiment.' },
        { label: DECLINE, description: 'Leave the workflow as it is.' },
      ],
      multiSelect: false as const,
    }))
}

function ownerMetricQuestions(state: ProjectState, item: WorkItemState): OwnerQuestion[] {
  const workflow = workflowOfWorkItem(state, item)
  return workflow.metrics
    .filter((metric) => metric.by === 'owner' && !item.metrics[metric.name] && item.passed_steps.includes(`${metric.at.stage}.${metric.at.step}`))
    .map((metric: WorkflowMetric) => ({
      kind: 'owner_metric' as const,
      work_item_id: item.work_item_id,
      stage: metric.at.stage,
      step: metric.at.step,
      metric: metric.name,
      question: `Metric "${metric.name}" for ${item.work_item_id} (${item.issue}): ${metric.instruction}`,
      header: header(metric.name),
      options: metric.categories.map((category) => ({ label: category.value, description: category.description })),
      multiSelect: false as const,
    }))
}

export function pendingOwnerQuestions(state: ProjectState): OwnerQuestion[] {
  const items = Object.values(state.workItems)
  return [
    ...items.flatMap((item) => ownerGateQuestion(state, item) ?? []),
    ...items.flatMap((item) => gateSkipQuestion(item) ?? []),
    ...items.flatMap((item) => ownerMetricQuestions(state, item)),
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

export function decideOwnerQuestion(state: ProjectState, question: OwnerQuestion, ownerAnswer: OwnerAnswer, via: 'question' | 'prompt'): AnswerOutcome {
  const words = [ownerAnswer.answer, ownerAnswer.notes].filter(Boolean).join(' - ')
  const unclear = { events: [], lines: [`Owner answered "${quote(words)}" to "${question.question}", which does not decide it. Answer Owner, then ask again with the same question.`] }
  switch (question.kind) {
    case 'owner_gate': {
      const verdict = ownerAnswer.answer === APPROVE ? 'approve' : ownerAnswer.answer === REJECT ? 'reject' : classifyOwnerWords(ownerAnswer.answer)
      if (verdict === 'unclear') return unclear
      const item = state.workItems[question.work_item_id]!
      const workflow = workflowOfWorkItem(state, item)
      const accepted = verdict === 'approve'
      const position = accepted ? nextPosition(workflow, question.stage, question.step) : { next: { stage: question.stage, step: question.step }, done: false }
      const rules = stepAt(workflow, question.stage, question.step)?.rules ?? []
      const stepLabel = `work step ${question.stage}.${question.step}`
      return {
        events: [
          {
            type: 'gate_verdict',
            work_item_id: question.work_item_id,
            stage: question.stage,
            step: question.step,
            accepted,
            by: 'owner',
            via,
            why: `Owner: "${quote(words)}"`,
            rule: rules.length ? rules.join(', ') : null,
            ...position,
          },
        ],
        lines: [
          accepted
            ? `Owner approved the Owner gate of ${stepLabel}. ${position.done ? 'Every work gate has passed: deliver the work item.' : `Next: work step ${position.next.stage}.${position.next.step} (work_status shows it).`}`
            : `Owner rejected the Owner gate of ${stepLabel}: "${quote(words)}". Do what Owner asks, report the impediment, and hand the gate in again.`,
        ],
      }
    }
    case 'proposal': {
      const typed = ownerAnswer.answer === APPROVE ? { approved: [question.proposal], declined: [] } : ownerAnswer.answer === DECLINE ? { approved: [], declined: [question.proposal] } : decideProposals(ownerAnswer.answer, [question.proposal])
      if (!typed || typed.approved.length + typed.declined.length === 0) return unclear
      const approved = typed.approved.includes(question.proposal)
      return {
        events: [{ type: 'owner_decided', retro_id: question.retro_id, approved: typed.approved, declined: typed.declined, prompt: words, via, ...(ownerAnswer.notes ? { comment: ownerAnswer.notes } : {}) }],
        lines: [`Owner ${approved ? 'approved' : 'declined'} proposal ${question.proposal}${ownerAnswer.notes ? ` (note: "${quote(ownerAnswer.notes)}")` : ''}.`],
      }
    }
    case 'gate_skip': {
      const verdict = ownerAnswer.answer === APPROVE ? 'approve' : ownerAnswer.answer === REJECT ? 'reject' : classifyOwnerWords(ownerAnswer.answer)
      if (verdict === 'unclear') return unclear
      const accepted = verdict === 'approve'
      const lateStart = state.workItems[question.work_item_id]!.late_start!
      const startAt = `${lateStart.start_at.stage}.${lateStart.start_at.step}`
      return {
        events: [{ type: 'late_start_judged', work_item_id: question.work_item_id, by: 'owner', via, accepted, why: `Owner: "${quote(words)}"`, rule: null }],
        lines: [accepted ? `Owner approved the late start: the work starts at work step ${startAt} (work_status shows it).` : 'Owner rejected the late start: start at the first work step.'],
      }
    }
    case 'owner_metric': {
      const category = question.options.find((option) => option.label === ownerAnswer.answer) ?? question.options.find((option) => new RegExp(`\\b${escapeRegExp(option.label)}\\b`, 'i').test(ownerAnswer.answer))
      if (!category) return unclear
      return {
        events: [
          {
            type: 'metric_recorded',
            work_item_id: question.work_item_id,
            stage: question.stage,
            step: question.step,
            name: question.metric,
            value: category.label,
            ...(ownerAnswer.notes ? { explanation: ownerAnswer.notes } : {}),
            by: 'owner',
          },
        ],
        lines: [`Owner recorded metric "${question.metric}": ${category.label}.`],
      }
    }
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function decideOwnerAnswers(state: ProjectState, answers: Record<string, unknown>, annotations: Record<string, unknown>, via: 'question' | 'prompt'): AnswerOutcome {
  const pending = pendingOwnerQuestions(state)
  const outcome: AnswerOutcome = { events: [], lines: [] }
  for (const [questionText, answer] of Object.entries(answers)) {
    const question = pending.find((candidate) => candidate.question === questionText)
    if (!question || typeof answer !== 'string') continue
    const notes = (annotations[questionText] as { notes?: unknown } | undefined)?.notes
    const decided = decideOwnerQuestion(state, question, { answer, ...(typeof notes === 'string' && notes.trim() ? { notes } : {}) }, via)
    outcome.events.push(...decided.events)
    outcome.lines.push(...decided.lines)
  }
  return outcome
}
