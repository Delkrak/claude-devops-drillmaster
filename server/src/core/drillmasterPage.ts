import type { ComplaintsGrouped, DrillmasterEvent, PostMortemWritten, WorkReported } from './events.js'
import { frictionPlacementsOf } from './frictionPlacement.js'
import { frictionJudgementsOf, ownerInputsOf } from './ownerInputs.js'
import { extractFirstJsonObject } from './review.js'
import { foldState } from './state.js'

export const COMPLAINT_GROUPING_REVIEW_KIND = 'complaint_grouping'

/** One complaint about Drillmaster: who made it, on which work item, and what it says. */
export interface Complaint {
  /** The event it is in, and for a post mortem which of its points: "ev_1f2e#2". */
  id: string
  at: string
  source: 'agent post mortem' | 'drillmaster post mortem' | 'agent impediment' | 'your step-in'
  work_item_id: string
  issue: string
  text: string
}

/** A problem heard more than once about a tool, in one line, with the complaints that say it. */
export interface Problem {
  summary: string
  complaints: Complaint[]
}

/** The complaints about one Drillmaster tool: its problems, biggest first, and the complaints in none of them, newest first. */
export interface ToolComplaints {
  tool: string
  heard: number
  problems: Problem[]
  /** Complaints Drillmaster has not grouped yet: made after its last grouping. */
  ungrouped: Complaint[]
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

/** Every complaint about a Drillmaster tool, by tool; `toolNames` are Drillmaster's tools, to find in what Agent reported. */
export function complaintsByTool(events: readonly DrillmasterEvent[], toolNames: readonly string[]) {
  const state = foldState(events)
  const issueOf = (workItemId: string) => state.workItems[workItemId]?.issue ?? workItemId
  const byTool = new Map<string, Complaint[]>()
  const add = (tool: string, complaint: Complaint) => byTool.set(tool, [...(byTool.get(tool) ?? []), complaint])
  for (const event of events) {
    if (event.type === 'post_mortem_written') {
      const postMortem = event as PostMortemWritten
      const source = postMortem.author === 'drillmaster' ? 'drillmaster post mortem' : 'agent post mortem'
      postMortem.change.forEach((feedback, index) => {
        const tools = new Set(feedback.refs.flatMap((mention) => TOOL_REF.exec(mention.ref)?.[1] ?? []))
        for (const tool of tools) add(tool, { id: `${event.id}#${index}`, at: event.at, source, work_item_id: event.work_item_id, issue: issueOf(event.work_item_id), text: feedback.text })
      })
    }
    if (event.type === 'work_reported' && (event as WorkReported).kind === 'impediment') {
      const report = event as WorkReported
      // A tool is named on its own or with its MCP prefix: "work_gate", "mcp__drillmaster__work_gate".
      for (const tool of toolNames.filter((name) => new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9_])`).test(report.text))) {
        add(tool, { id: event.id, at: event.at, source: 'agent impediment', work_item_id: report.work_item_id, issue: issueOf(report.work_item_id), text: report.text })
      }
    }
  }
  return byTool
}

/** The page at `at` (every event, when not given). */
export function drillmasterPageView(events: readonly DrillmasterEvent[], toolNames: readonly string[], at?: string): DrillmasterPage {
  const seen = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(seen)
  const issueOf = (workItemId: string) => state.workItems[workItemId]?.issue ?? workItemId
  const grouping = seen.filter((event): event is ComplaintsGrouped => event.type === 'complaints_grouped').at(-1)

  const tools = [...complaintsByTool(seen, toolNames)].map(([tool, complaints]): ToolComplaints => {
    const byId = new Map(complaints.map((complaint) => [complaint.id, complaint]))
    const problems = (grouping?.groups ?? [])
      .filter((group) => group.tool === tool)
      .map((group) => ({ summary: group.summary, complaints: group.complaints.flatMap((id) => byId.get(id) ?? []).sort(newestFirst) }))
      .filter((problem) => problem.complaints.length > 0)
      .sort((a, b) => b.complaints.length - a.complaints.length)
    const grouped = new Set(problems.flatMap((problem) => problem.complaints.map((complaint) => complaint.id)))
    return { tool, heard: complaints.length, problems, ungrouped: complaints.filter((complaint) => !grouped.has(complaint.id)).sort(newestFirst) }
  })
  const latestOf = (tool: ToolComplaints) => [...tool.problems.flatMap((problem) => problem.complaints), ...tool.ungrouped].sort(newestFirst)[0]!
  tools.sort((a, b) => b.heard - a.heard || newestFirst(latestOf(a), latestOf(b)))

  const judgements = frictionJudgementsOf(seen)
  const placements = frictionPlacementsOf(seen)
  const uncovered = ownerInputsOf(seen).flatMap((input): Complaint[] => {
    const placement = placements.get(input.event_id)
    if (!input.work_item_id || !judgements.get(input.event_id)?.friction || !placement || placement.step_guid !== null) return []
    return [{ id: input.event_id, at: input.at, source: 'your step-in', work_item_id: input.work_item_id, issue: issueOf(input.work_item_id), text: `"${input.prompt}" ${placement.why}` }]
  })
  return { tools, uncovered: uncovered.sort(newestFirst) }
}

/** Drillmaster groups each tool's complaints into the problems they repeat, one line each. */
export function buildComplaintGroupingPrompt(byTool: ReadonlyMap<string, readonly Complaint[]>) {
  return [
    "You are Drillmaster. Below are the complaints about Drillmaster's own tools, from post mortems and from Agent's reports.",
    'For each tool, group its complaints by the problem they describe: complaints that point at the same underlying problem go in one group, even when worded differently. A complaint about two problems goes in the group of its main one.',
    "Give each group a summary for Owner, a CEO who is not a developer: one line, at most 70 characters, the problem and its consequence, in plain words, no step numbers or event ids.",
    '',
    ...[...byTool].flatMap(([tool, complaints]) => [`Tool ${tool}:`, ...complaints.map((complaint) => `- ${complaint.id} (${complaint.source}, ${complaint.issue}): ${complaint.text}`), '']),
    'Answer with JSON only:',
    '{"groups": [{"tool": "<tool>", "summary": "<one line>", "complaints": ["<complaint id>", ...]}]}',
  ].join('\n')
}

/** Keeps the groups of tools and complaints that were asked about; each complaint in one group only. */
export function readComplaintGroupingAnswer(byTool: ReadonlyMap<string, readonly Complaint[]>, answer: unknown): ComplaintsGrouped['groups'] {
  const parsed = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { groups?: unknown } | undefined
  if (!parsed || !Array.isArray(parsed.groups)) return []
  const placed = new Set<string>()
  return parsed.groups.flatMap((group: { tool?: unknown; summary?: unknown; complaints?: unknown }) => {
    const asked = typeof group.tool === 'string' ? byTool.get(group.tool) : undefined
    if (!asked || typeof group.summary !== 'string' || !Array.isArray(group.complaints)) return []
    const known = new Set(asked.map((complaint) => complaint.id))
    const complaints = group.complaints.filter((id): id is string => typeof id === 'string' && known.has(id) && !placed.has(id))
    complaints.forEach((id) => placed.add(id))
    return complaints.length > 0 ? [{ tool: group.tool as string, summary: group.summary.trim(), complaints }] : []
  })
}
