import { z } from 'zod'
import type { DrillmasterEvent, MeasureJudgement } from './events.js'
import { judgedMeasuresOf } from './measures.js'
import { stepGuidAt } from './refs.js'
import { extractFirstJsonObject } from './review.js'
import type { WorkItemState } from './state.js'
import { workflowForReading, type WorkflowDocument } from './workflow.js'

/** What Drillmaster's post mortem is told about the measures it judges for the work item. */
export function measuresToJudge(workflow: WorkflowDocument): string[] {
  if (workflow.measures.length === 0) return []
  return [
    'The measures the workflow defines. Each counts something that should not happen. For each measure, list every occurrence on this work item that its definition counts, judged from everything recorded above, Owner\'s inputs included.',
    'For each occurrence, name the work step that should have caught it ("3.1"), or null when no step of the workflow covers it; the ids of the recorded events it is about; and why it counts, in one sentence.',
    'List each measure, with no occurrences when nothing counts.',
    ...workflow.measures.map((measure) => `- "${measure.name}": ${measure.definition}`),
  ]
}

export const MEASURED_ANSWER_EXAMPLE = '"measured":[{"measure":"<its name>","occurrences":[{"step":"3.1","events":["<event id>"],"why":"<one sentence>"}]}]'

const Occurrence = z.object({ step: z.unknown(), events: z.array(z.string()).catch([]), why: z.string().catch('') })
const MeasuredAnswer = z.array(z.object({ measure: z.string(), occurrences: z.array(Occurrence.loose()).catch([]) }).loose()).catch([])

const stepGuidOfAnswer = (workflow: WorkflowDocument, step: unknown) => {
  const stepRef = typeof step === 'string' ? /^(?:step\s+)?(\d+)\.(\d+)$/.exec(step.trim()) : null
  return stepRef ? (stepGuidAt(workflow, Number(stepRef[1]), Number(stepRef[2])) ?? null) : null
}

/**
 * Drillmaster's judgement of every measure the workflow defines: a measure it left out counts no
 * occurrences, a measure the workflow doesn't define is dropped, and so is an event that isn't the
 * work item's.
 */
export function readMeasuredAnswer(workflow: WorkflowDocument, itemEventIds: ReadonlySet<string>, measured: unknown): MeasureJudgement[] {
  const answered = MeasuredAnswer.parse(measured)
  return workflow.measures.map((measure) => ({
    measure: measure.name,
    occurrences: answered
      .filter((candidate) => candidate.measure === measure.name)
      .flatMap((candidate) => candidate.occurrences)
      .map((occurrence) => ({ step_guid: stepGuidOfAnswer(workflow, occurrence.step), events: occurrence.events.filter((id) => itemEventIds.has(id)), why: occurrence.why })),
  }))
}

export const LATE_MEASURES_REVIEW_KIND = 'late_measures'

/** One recorded event as Drillmaster reads it, by its id: a trace in a line, anything else as JSON. */
export const eventLine = (event: DrillmasterEvent) =>
  event.type === 'work_trace'
    ? `- ${event.id} ${event.hook}${event.tool ? ` ${event.tool}` : ''}${event.input ? ` ${event.input}` : ''}${event.prompt ? ` Owner: "${event.prompt}"` : ''}`
    : `- ${JSON.stringify(event)}`

const isEventOf = (workItemId: string) => (event: DrillmasterEvent) => 'work_item_id' in event && event.work_item_id === workItemId

/**
 * The work items whose measures were judged and that Owner has said something on since: each with
 * the events Drillmaster has not judged yet.
 */
export function itemsToJudgeLate(events: readonly DrillmasterEvent[]) {
  const judged = judgedMeasuresOf(events)
  return [...judged.keys()].flatMap((workItemId) => {
    const itemEvents = events.filter(isEventOf(workItemId))
    const lastJudging = itemEvents.findLastIndex((event) => (event.type === 'post_mortem_written' && event.author === 'drillmaster') || event.type === 'late_measures_judged')
    const unjudged = itemEvents.slice(lastJudging + 1)
    const ownerSpoke = unjudged.some((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit')
    return ownerSpoke ? [{ workItemId, unjudged }] : []
  })
}

export function buildLateMeasuresPrompt(item: WorkItemState, workflow: WorkflowDocument, unjudged: readonly DrillmasterEvent[]) {
  return [
    `You are Drillmaster. You wrote your post mortem on work item ${item.work_item_id} (${item.issue}) when it was delivered, and judged the workflow's measures then. Since then, this happened on it, oldest first:`,
    ...unjudged.map(eventLine),
    '',
    `The workflow it ran on (version ${workflow.version}):`,
    workflowForReading(workflow),
    '',
    ...measuresToJudge(workflow),
    'Judge only what happened since your post mortem, listed above.',
    '',
    'Answer with JSON only:',
    `{${MEASURED_ANSWER_EXAMPLE}}`,
  ].join('\n')
}

export function readLateMeasuresAnswer(workflow: WorkflowDocument, unjudged: readonly DrillmasterEvent[], answer: unknown) {
  const answered = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { measured?: unknown } | undefined
  return readMeasuredAnswer(workflow, new Set(unjudged.map((event) => event.id)), answered?.measured)
}
