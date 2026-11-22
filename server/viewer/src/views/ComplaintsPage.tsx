import { Fragment, useState } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { dayAndTime } from '../time'
import type { Complaint, DrillmasterPage } from '../types'
import { ComplaintGroup, ComplaintLine, ComplaintList, ProblemHeading } from '../ui/complaint/List'
import { Empty } from '../ui/Empty'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'
import { ProjectNav } from './ProjectNav'

const SOURCE_IN_WORDS: Record<Complaint['source'], string> = {
  'agent post mortem': "Agent's post mortem",
  'drillmaster post mortem': "Drillmaster's post mortem",
  'agent impediment': 'Agent, while working',
  'your step-in': 'you stepped in',
}

const UNCOVERED_GROUP_NAME = 'no step covers it'
const NOT_GROUPED_HEADING = 'new since Drillmaster last grouped them'

function headlineOf(tool: DrillmasterPage['tools'][number]) {
  const [biggestProblem] = tool.problems
  return biggestProblem
    ? { text: `${biggestProblem.summary} (${biggestProblem.complaints.length} of ${tool.heard})`, isLatestComplaint: false }
    : { text: tool.ungrouped[0]!.text, isLatestComplaint: true }
}

export function ComplaintsPage({ projectId, at }: { projectId: string; at: string | null }) {
  const loaded = usePolled(() => api.drillmasterPage(projectId, at), `${projectId}@${at ?? 'now'}`, at ? null : undefined)
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
  const toggleGroup = (name: string) =>
    setOpenGroups((current) => {
      const next = new Set(current)
      if (!next.delete(name)) next.add(name)
      return next
    })
  const complaintLines = (complaints: readonly Complaint[]) =>
    complaints.map((complaint) => (
      <ComplaintLine
        key={complaint.id}
        who={SOURCE_IN_WORDS[complaint.source]}
        issue={complaint.issue}
        workItemHref={href.workItem(projectId, complaint.work_item_id, at)}
        when={dayAndTime(complaint.at)}
        text={complaint.text}
      />
    ))
  return (
    <Shell title="Complaints about Drillmaster" aside={<ProjectNav projectId={projectId} at={at} nowHref={href.complaints(projectId)} currentPage="complaints" />}>
      <Loading loaded={loaded}>
        {(page) =>
          page.tools.length === 0 && page.uncovered.length === 0 ? (
            <Empty>No complaints about Drillmaster yet.</Empty>
          ) : (
            <ComplaintList>
              {page.tools.map((tool) => {
                const headline = headlineOf(tool)
                return (
                  <ComplaintGroup
                    key={tool.tool}
                    name={tool.tool}
                    heardCount={tool.heard}
                    headline={headline.text}
                    headlineIsLatestComplaint={headline.isLatestComplaint}
                    open={openGroups.has(tool.tool)}
                    onToggle={() => toggleGroup(tool.tool)}
                  >
                    {tool.problems.map((problem) => (
                      <Fragment key={problem.summary}>
                        <ProblemHeading summary={problem.summary} complaintCount={problem.complaints.length} toolComplaintCount={tool.heard} />
                        {complaintLines(problem.complaints)}
                      </Fragment>
                    ))}
                    {tool.ungrouped.length > 0 && (
                      <>
                        {tool.problems.length > 0 && <ProblemHeading summary={NOT_GROUPED_HEADING} complaintCount={tool.ungrouped.length} toolComplaintCount={tool.heard} />}
                        {complaintLines(tool.ungrouped)}
                      </>
                    )}
                  </ComplaintGroup>
                )
              })}
              {page.uncovered.length > 0 && (
                <ComplaintGroup
                  name={UNCOVERED_GROUP_NAME}
                  isWorkflowGap
                  heardCount={page.uncovered.length}
                  headline={page.uncovered[0]!.text}
                  headlineIsLatestComplaint
                  open={openGroups.has(UNCOVERED_GROUP_NAME)}
                  onToggle={() => toggleGroup(UNCOVERED_GROUP_NAME)}
                >
                  {complaintLines(page.uncovered)}
                </ComplaintGroup>
              )}
            </ComplaintList>
          )
        }
      </Loading>
    </Shell>
  )
}
