import type { ComplaintsGrouped, DrillmasterEvent, PostMortemWritten, WorkReported } from './events.js'
import { marksOf, OLD_FRICTION } from './marks.js'
import { extractFirstJsonObject } from './review.js'
import { foldState } from './state.js'

export const COMPLAINT_GROUPING_REVIEW_KIND = 'complaint_grouping'

export interface Complaint {
  id: string
  at: string
  /** Where it came from: a post mortem, Agent's report of an impediment, or a measure the viewer shows. */
  source: 'agent post mortem' | 'drillmaster post mortem' | 'agent impediment' | 'your step-in' | 'a measure'
  work_item_id: string
  issue: string
  text: string
}

export interface Problem {
  summary: string
  complaints: Complaint[]
}

export interface ToolComplaints {
  tool: string
  heard: number
  problems: Problem[]
  ungrouped: Complaint[]
}

export interface DrillmasterPage {
  tools: ToolComplaints[]
  uncovered: Complaint[]
}

const TOOL_REF = /^tool (\S+)$/
const newestFirst = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at)

export function complaintsByTool(events: readonly DrillmasterEvent[], toolNames: readonly string[]) {
  const state = foldState(events)
  const issueOf = (workItemId: string) => state.workItems[workItemId]?.issue ?? workItemId
  const complaintsOfTool = new Map<string, Complaint[]>()
  const addComplaint = (tool: string, complaint: Complaint) => complaintsOfTool.set(tool, [...(complaintsOfTool.get(tool) ?? []), complaint])
  for (const event of events) {
    if (event.type === 'post_mortem_written') {
      const postMortem = event as PostMortemWritten
      const source = postMortem.author === 'drillmaster' ? 'drillmaster post mortem' : 'agent post mortem'
      postMortem.change.forEach((feedback, index) => {
        const toolsMentioned = new Set(feedback.refs.flatMap((mention) => TOOL_REF.exec(mention.ref)?.[1] ?? []))
        for (const tool of toolsMentioned) addComplaint(tool, { id: `${event.id}#${index}`, at: event.at, source, work_item_id: event.work_item_id, issue: issueOf(event.work_item_id), text: feedback.text })
      })
    }
    if (event.type === 'work_reported' && (event as WorkReported).kind === 'impediment') {
      const report = event as WorkReported
      // A tool is named on its own or with its MCP prefix: "work_gate", "mcp__drillmaster__work_gate".
      for (const tool of toolNames.filter((name) => new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9_])`).test(report.text))) {
        addComplaint(tool, { id: event.id, at: event.at, source: 'agent impediment', work_item_id: report.work_item_id, issue: issueOf(report.work_item_id), text: report.text })
      }
    }
  }
  return complaintsOfTool
}

export function drillmasterPageView(events: readonly DrillmasterEvent[], toolNames: readonly string[], at?: string): DrillmasterPage {
  const eventsUntilAt = at ? events.filter((event) => event.at <= at) : events
  const state = foldState(eventsUntilAt)
  const issueOf = (workItemId: string) => state.workItems[workItemId]?.issue ?? workItemId
  const latestGrouping = eventsUntilAt.filter((event): event is ComplaintsGrouped => event.type === 'complaints_grouped').at(-1)

  const tools = [...complaintsByTool(eventsUntilAt, toolNames)].map(([tool, complaints]): ToolComplaints => {
    const complaintById = new Map(complaints.map((complaint) => [complaint.id, complaint]))
    const problems = (latestGrouping?.groups ?? [])
      .filter((group) => group.tool === tool)
      .map((group) => ({ summary: group.summary, complaints: group.complaints.flatMap((id) => complaintById.get(id) ?? []).sort(newestFirst) }))
      .filter((problem) => problem.complaints.length > 0)
      .sort((a, b) => b.complaints.length - a.complaints.length)
    const groupedIds = new Set(problems.flatMap((problem) => problem.complaints.map((complaint) => complaint.id)))
    return { tool, heard: complaints.length, problems, ungrouped: complaints.filter((complaint) => !groupedIds.has(complaint.id)).sort(newestFirst) }
  })
  const latestComplaintOf = (tool: ToolComplaints) => [...tool.problems.flatMap((problem) => problem.complaints), ...tool.ungrouped].sort(newestFirst)[0]!
  tools.sort((a, b) => b.heard - a.heard || newestFirst(latestComplaintOf(a), latestComplaintOf(b)))

  const uncovered = (state.workflow ? marksOf(eventsUntilAt, state.workflow).marks : [])
    .filter((mark) => mark.step_guid === null)
    .map((mark, index): Complaint => {
      const said = mark.prompts.map((prompt) => `"${prompt}" `).join('')
      return mark.measure === OLD_FRICTION
        ? { id: `uncovered#${index}`, at: mark.at, source: 'your step-in', work_item_id: mark.work_item_id, issue: issueOf(mark.work_item_id), text: `${said}${mark.placed_why ?? mark.why}` }
        : { id: `uncovered#${index}`, at: mark.at, source: 'a measure', work_item_id: mark.work_item_id, issue: issueOf(mark.work_item_id), text: `${mark.measure}: ${said}${mark.why}` }
    })
  return { tools, uncovered: uncovered.sort(newestFirst) }
}

export function buildComplaintGroupingPrompt(complaintsOfTool: ReadonlyMap<string, readonly Complaint[]>) {
  return [
    "You are Drillmaster. Below are the complaints about Drillmaster's own tools, from post mortems and from Agent's reports.",
    'For each tool, group its complaints by the problem they describe: complaints that point at the same underlying problem go in one group, even when worded differently. A complaint about two problems goes in the group of its main one.',
    "Give each group a summary for Owner, a CEO who is not a developer: one line, at most 70 characters, the problem and its consequence, in plain words, no step numbers or event ids.",
    '',
    ...[...complaintsOfTool].flatMap(([tool, complaints]) => [`Tool ${tool}:`, ...complaints.map((complaint) => `- ${complaint.id} (${complaint.source}, ${complaint.issue}): ${complaint.text}`), '']),
    'Answer with JSON only:',
    '{"groups": [{"tool": "<tool>", "summary": "<one line>", "complaints": ["<complaint id>", ...]}]}',
  ].join('\n')
}

export function readComplaintGroupingAnswer(complaintsOfTool: ReadonlyMap<string, readonly Complaint[]>, answer: unknown): ComplaintsGrouped['groups'] {
  const parsedAnswer = (typeof answer === 'string' ? extractFirstJsonObject(answer) : answer) as { groups?: unknown } | undefined
  if (!parsedAnswer || !Array.isArray(parsedAnswer.groups)) return []
  const groupedIds = new Set<string>()
  return parsedAnswer.groups.flatMap((group: { tool?: unknown; summary?: unknown; complaints?: unknown }) => {
    const askedComplaints = typeof group.tool === 'string' ? complaintsOfTool.get(group.tool) : undefined
    if (!askedComplaints || typeof group.summary !== 'string' || !Array.isArray(group.complaints)) return []
    const askedIds = new Set(askedComplaints.map((complaint) => complaint.id))
    const complaintIds = group.complaints.filter((id): id is string => typeof id === 'string' && askedIds.has(id) && !groupedIds.has(id))
    complaintIds.forEach((id) => groupedIds.add(id))
    return complaintIds.length > 0 ? [{ tool: group.tool as string, summary: group.summary.trim(), complaints: complaintIds }] : []
  })
}
