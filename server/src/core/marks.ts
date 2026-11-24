// Where the measures the viewer shows happened, for the pages: each occurrence Drillmaster judged of a
// measure the workflow shows, and the friction Drillmaster 0.3 judged apart, as "friction (old)".

import type { DrillmasterEvent } from './events.js'
import { judgedMeasuresOf, writtenBeforeMeasuresWereJudged } from './measures.js'
import { frictionJudgementsOf, frictionPlacementsOf, isFriction, ownerInputsOf } from './ownerInputs.js'
import type { WorkflowDocument } from './workflow.js'

export const OLD_FRICTION = 'friction (old)'

const OLD_FRICTION_DEFINITION = "Owner's inputs a separate judge called friction, and Owner gates Owner sent back, before the workflow defined its measures."

/** A measure the pages show, in the order the key lists them. */
export interface ShownMeasure {
  name: string
  definition: string
  old: boolean
}

/** One occurrence of a shown measure on a work item. */
export interface Mark {
  measure: string
  work_item_id: string
  /** The step that should have caught it; null when no step covers it. */
  step_guid: string | null
  at: string
  /** Only old friction says so: what Owner said after delivery. */
  after_delivery: boolean
  why: string
  /** Why old friction belongs at its step, or why no step covers it, as Drillmaster placed it. */
  placed_why: string | null
  /** What Owner said, in the events it is about. */
  prompts: string[]
}

/** The marks of the measures the workflow shows, and of old friction, with the measures that have any. */
export function marksOf(events: readonly DrillmasterEvent[], workflow: WorkflowDocument): { measures: ShownMeasure[]; marks: Mark[] } {
  const shown = workflow.measures.filter((measure) => measure.show)
  const promptByEventId = new Map(events.flatMap((event) => (event.type === 'work_trace' && event.prompt !== undefined ? [[event.id, event.prompt] as const] : [])))
  const atByEventId = new Map(events.map((event) => [event.id, event.at]))
  const marks: Mark[] = []

  for (const event of events) {
    if (event.type !== 'post_mortem_written' && event.type !== 'late_measures_judged') continue
    if (event.type === 'post_mortem_written' && event.author !== 'drillmaster') continue
    for (const judgement of event.measured ?? []) {
      if (!shown.some((measure) => measure.name === judgement.measure)) continue
      for (const occurrence of judgement.occurrences) {
        marks.push({
          measure: judgement.measure,
          work_item_id: event.work_item_id,
          step_guid: occurrence.step_guid,
          at: occurrence.events.map((id) => atByEventId.get(id) ?? '').filter(Boolean).sort()[0] ?? event.at,
          after_delivery: false,
          why: occurrence.why,
          placed_why: null,
          prompts: occurrence.events.flatMap((id) => promptByEventId.get(id) ?? []),
        })
      }
    }
  }
  // Late occurrences count only on top of a post mortem that judged the measures; a work item judged so has no old friction.
  const judgedItemIds = new Set(judgedMeasuresOf(events).keys())
  const judgedMarks = marks.filter((mark) => judgedItemIds.has(mark.work_item_id))
  const hasOldFriction = (workItemId: string, drillmasterVersion: string | undefined) => !judgedItemIds.has(workItemId) && writtenBeforeMeasuresWereJudged(drillmasterVersion)

  const oldMarks: Mark[] = []
  for (const event of events) {
    if (event.type !== 'gate_verdict' || event.by !== 'owner' || event.accepted || !hasOldFriction(event.work_item_id, event.drillmaster_version)) continue
    oldMarks.push({ measure: OLD_FRICTION, work_item_id: event.work_item_id, step_guid: event.step_guid ?? null, at: event.at, after_delivery: false, why: `you sent it back at your gate: ${event.why}`, placed_why: null, prompts: [] })
  }
  const frictionJudgements = frictionJudgementsOf(events)
  const frictionPlacements = frictionPlacementsOf(events)
  const versionByEventId = new Map(events.map((event) => [event.id, event.drillmaster_version]))
  for (const input of ownerInputsOf(events)) {
    if (!input.work_item_id || !hasOldFriction(input.work_item_id, versionByEventId.get(input.event_id)) || !isFriction(input, frictionJudgements)) continue
    const placement = frictionPlacements.get(input.event_id)
    oldMarks.push({
      measure: OLD_FRICTION,
      work_item_id: input.work_item_id,
      step_guid: placement?.step_guid ?? null,
      at: input.at,
      after_delivery: input.after_delivery,
      why: frictionJudgements.get(input.event_id)?.why ?? '',
      placed_why: placement?.why ?? null,
      prompts: [input.prompt],
    })
  }

  const measures: ShownMeasure[] = [...shown.map((measure) => ({ name: measure.name, definition: measure.definition, old: false })), ...(oldMarks.length ? [{ name: OLD_FRICTION, definition: OLD_FRICTION_DEFINITION, old: true }] : [])]
  return { measures, marks: [...judgedMarks, ...oldMarks].sort((a, b) => a.at.localeCompare(b.at)) }
}

/** How many marks of each measure, in the order of the measures; measures without marks are left out. */
export const countsByMeasure = (measures: readonly ShownMeasure[], marks: readonly Mark[]) =>
  measures.flatMap((measure) => {
    const count = marks.filter((mark) => mark.measure === measure.name).length
    return count ? [{ measure: measure.name, count }] : []
  })
