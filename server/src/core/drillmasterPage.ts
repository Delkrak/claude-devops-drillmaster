import type { DrillmasterEvent, PostMortemWritten, WorkReported } from './events.js'
import { frictionJudgementsOf, ownerInputsOf } from './ownerInputs.js'
import { frictionPlacementsOf } from './frictionPlacement.js'
import { foldState } from './state.js'

/** One complaint about Drillmaster: who made it, on which work item, and what it says. */
export interface Complaint {
  at: string
  source: 'agent post mortem' | 'drillmaster post mortem' | 'agent impediment' | 'your step-in'
  work_item_id: string
  issue: string
  text: string
}

/** The complaints about one Drillmaster tool, newest first. */
export interface ToolComplaints {
  tool: string
  complaints: Complaint[]
}

/** What to fix next in Drillmaster: complaints about its tools, and Owner's step-ins no workflow step covers. */
export interface DrillmasterPage {
  /** Most complained about first; between equal counts, the most recent first. */
  tools: ToolComplaints[]
  /** Step-ins Drillmaster placed at no step: no step of the workflow covers them, a gap Drillmaster may need to fill. */
  uncovered: Complaint[]
}

const TOOL_REF = /^tool (\S+)$/
const newestFirst = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at)

/** The page at `at` (every event, when not given); `toolNames` are Drillmaster's tools, to find in what Agent reported. */
export function drillmasterPageView(events: readonly DrillmasterEvent[], toolNames: readonly string[], at?: string): DrillmasterPage {
  const seen = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(seen)
  const issueOf = (workItemId: string) => state.workItems[workItemId]?.issue ?? workItemId
  const byTool = new Map<string, Complaint[]>()
  const add = (tool: string, complaint: Complaint) => byTool.set(tool, [...(byTool.get(tool) ?? []), complaint])

  for (const event of seen) {
    if (event.type === 'post_mortem_written') {
      const postMortem = event as PostMortemWritten
      for (const feedback of postMortem.change) {
        const tools = new Set(feedback.refs.flatMap((mention) => TOOL_REF.exec(mention.ref)?.[1] ?? []))
        const source = postMortem.author === 'drillmaster' ? 'drillmaster post mortem' : 'agent post mortem'
        for (const tool of tools) add(tool, { at: event.at, source, work_item_id: event.work_item_id, issue: issueOf(event.work_item_id), text: feedback.text })
      }
    }
    if (event.type === 'work_reported' && (event as WorkReported).kind === 'impediment') {
      const report = event as WorkReported
      for (const tool of toolNames.filter((name) => new RegExp(`\\b${name}\\b`).test(report.text))) {
        add(tool, { at: event.at, source: 'agent impediment', work_item_id: report.work_item_id, issue: issueOf(report.work_item_id), text: report.text })
      }
    }
  }

  const judgements = frictionJudgementsOf(seen)
  const placements = frictionPlacementsOf(seen)
  const uncovered = ownerInputsOf(seen).flatMap((input): Complaint[] => {
    const placement = placements.get(input.event_id)
    if (!input.work_item_id || !judgements.get(input.event_id)?.friction || !placement || placement.step_guid !== null) return []
    return [{ at: input.at, source: 'your step-in', work_item_id: input.work_item_id, issue: issueOf(input.work_item_id), text: `"${input.prompt}" ${placement.why}` }]
  })

  const tools = [...byTool].map(([tool, complaints]) => ({ tool, complaints: complaints.sort(newestFirst) }))
  tools.sort((a, b) => b.complaints.length - a.complaints.length || newestFirst(a.complaints[0]!, b.complaints[0]!))
  return { tools, uncovered: uncovered.sort(newestFirst) }
}
