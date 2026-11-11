import { z } from 'zod'
import type { DrillmasterEvent } from './events.js'
import { InvalidReference, resolveRef } from './refs.js'
import type { WorkflowDocument } from './workflow.js'

/** A reference as feedback stores it: as it was written, and the GUID behind it (none for a tool). */
export interface RefMention {
  ref: string
  guid: string | null
}

/** One piece of feedback, and the components of the workflow, or the tools, it is about. */
export interface Feedback {
  refs: RefMention[]
  text: string
}

export interface ExperimentReflection {
  experiment: number | null
  text: string
}

export const FeedbackInput = z.object({ refs: z.array(z.string().min(1)), text: z.string().min(1) }).strict()
export const ReflectionInput = z.object({ experiment: z.number().int().positive(), text: z.string().min(1) }).strict()
export type FeedbackInput = z.infer<typeof FeedbackInput>

export const FEEDBACK_REFS_HELP =
  'refs name what it is about: "step 1.2", "stage 1", "rule pr 1.1", "policy pr", "input kind", "capture tests", or "tool work_deliver" for Drillmaster itself. Leave refs empty for the workflow as a whole.'

/**
 * Resolves each entry's references in `workflow`. With `unknownRefs: 'refuse'` a reference to
 * nothing is an error the writer must fix; with 'drop' it is left out, for answers no one can fix.
 */
export function resolveFeedback(workflow: WorkflowDocument, entries: readonly FeedbackInput[], toolNames: readonly string[], unknownRefs: 'refuse' | 'drop'): Feedback[] {
  return entries.map((entry) => ({
    text: entry.text,
    refs: entry.refs.flatMap((text) => {
      try {
        const resolved = resolveRef(workflow, text, { toolNames })
        return [{ ref: resolved.ref, guid: resolved.guid }]
      } catch (error) {
        if (unknownRefs === 'drop' && error instanceof InvalidReference) return []
        throw error
      }
    }),
  }))
}

const asFeedbackList = (value: unknown): Feedback[] => {
  if (Array.isArray(value)) return value as Feedback[]
  return typeof value === 'string' && value.trim() ? [{ refs: [], text: value }] : []
}

const inputRefs = (entries: readonly Feedback[]) =>
  entries.map((entry) => ({ ...entry, refs: entry.refs.map((mention) => (mention.ref.startsWith('metric ') ? { ...mention, ref: `input ${mention.ref.slice('metric '.length)}` } : mention)) }))

/**
 * Reads events written by earlier Drillmasters: feedback written as text becomes lists without refs,
 * and metrics become work item inputs.
 */
export function migrateEvent(raw: DrillmasterEvent): DrillmasterEvent {
  const event = (raw as { type: string }).type === 'metric_recorded' ? ({ ...raw, type: 'input_set' } as DrillmasterEvent) : raw
  if (event.type === 'post_mortem_written' && Array.isArray(event.keep)) return { ...event, keep: inputRefs(event.keep), change: inputRefs(event.change) }
  if (event.type === 'retrospective_ran' && Array.isArray(event.findings.keep)) {
    return { ...event, findings: { ...event.findings, keep: inputRefs(event.findings.keep), improve: inputRefs(event.findings.improve) } }
  }
  if (event.type === 'post_mortem_written') {
    const legacy = event as unknown as { keep: unknown; change: unknown; experiment_reflections: unknown; free_text?: unknown }
    const { free_text: freeText, ...rest } = legacy
    return {
      ...(rest as unknown as DrillmasterEvent & { type: 'post_mortem_written' }),
      keep: asFeedbackList(legacy.keep),
      change: [...asFeedbackList(legacy.change), ...asFeedbackList(freeText)],
      experiment_reflections: asFeedbackList(legacy.experiment_reflections).map((entry) => ({ experiment: null, text: entry.text })),
    }
  }
  if (event.type === 'retrospective_ran') {
    const findings = event.findings as unknown as { keep: unknown; improve: unknown }
    return { ...event, findings: { ...event.findings, keep: asFeedbackList(findings.keep), improve: asFeedbackList(findings.improve) } }
  }
  return event
}

export interface DrillmasterFeedback {
  at: string
  tool: string
  text: string
  from: string
  work_item_id: string | null
}

/** Every piece of feedback that names one of Drillmaster's tools: feedback on Drillmaster itself. */
export function feedbackOnDrillmaster(events: readonly DrillmasterEvent[]): DrillmasterFeedback[] {
  return events.flatMap((event) => {
    const entries =
      event.type === 'post_mortem_written'
        ? [...event.keep, ...event.change].map((entry) => ({ entry, from: `${event.author}'s post mortem`, workItemId: event.work_item_id as string | null }))
        : event.type === 'retrospective_ran'
          ? [...event.findings.keep, ...event.findings.improve].map((entry) => ({ entry, from: `retrospective ${event.retro_id}`, workItemId: null }))
          : []
    return entries.flatMap(({ entry, from, workItemId }) =>
      entry.refs.filter((mention) => mention.ref.startsWith('tool ')).map((mention) => ({ at: event.at, tool: mention.ref.slice('tool '.length), text: entry.text, from, work_item_id: workItemId })),
    )
  })
}
