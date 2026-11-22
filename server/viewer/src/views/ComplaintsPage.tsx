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

const WHO: Record<Complaint['source'], string> = {
  'agent post mortem': "Agent's post mortem",
  'drillmaster post mortem': "Drillmaster's post mortem",
  'agent impediment': 'Agent, while working',
  'your step-in': 'you stepped in',
}

const UNCOVERED = 'no step covers it'
const NOT_GROUPED = 'new since Drillmaster last grouped them'

/** The row's line: the biggest problem and its count, or, before any grouping, the latest complaint. */
function biggest(tool: DrillmasterPage['tools'][number]) {
  const [first] = tool.problems
  return first ? { text: `${first.summary} (${first.complaints.length} of ${tool.heard})`, quiet: false } : { text: tool.ungrouped[0]!.text, quiet: true }
}

/** What's wrong in Drillmaster: its tools, most complained about first, each with its biggest problem; open, every problem and complaint. */
export function ComplaintsPage({ id, at }: { id: string; at: string | null }) {
  const loaded = usePolled(() => api.drillmaster(id, at), `${id}@${at ?? 'now'}`, at ? null : undefined)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(name)) next.add(name)
      return next
    })
  const lines = (complaints: readonly Complaint[]) =>
    complaints.map((complaint) => (
      <ComplaintLine key={complaint.id} who={WHO[complaint.source]} issue={complaint.issue} to={href.workItem(id, complaint.work_item_id, at)} when={dayAndTime(complaint.at)} text={complaint.text} />
    ))
  return (
    <Shell title="Complaints about Drillmaster" aside={<ProjectNav id={id} at={at} nowHref={href.complaints(id)} here="complaints" />}>
      <Loading loaded={loaded}>
        {(page) =>
          page.tools.length === 0 && page.uncovered.length === 0 ? (
            <Empty>No complaints about Drillmaster yet.</Empty>
          ) : (
            <ComplaintList>
              {page.tools.map((tool) => {
                const line = biggest(tool)
                return (
                  <ComplaintGroup key={tool.tool} name={tool.tool} count={tool.heard} latest={line.text} quiet={line.quiet} open={open.has(tool.tool)} onToggle={() => toggle(tool.tool)}>
                    {tool.problems.map((problem) => (
                      <Fragment key={problem.summary}>
                        <ProblemHeading summary={problem.summary} count={problem.complaints.length} of={tool.heard} />
                        {lines(problem.complaints)}
                      </Fragment>
                    ))}
                    {tool.ungrouped.length > 0 && (
                      <>
                        {tool.problems.length > 0 && <ProblemHeading summary={NOT_GROUPED} count={tool.ungrouped.length} of={tool.heard} />}
                        {lines(tool.ungrouped)}
                      </>
                    )}
                  </ComplaintGroup>
                )
              })}
              {page.uncovered.length > 0 && (
                <ComplaintGroup name={UNCOVERED} gap count={page.uncovered.length} latest={page.uncovered[0]!.text} quiet open={open.has(UNCOVERED)} onToggle={() => toggle(UNCOVERED)}>
                  {lines(page.uncovered)}
                </ComplaintGroup>
              )}
            </ComplaintList>
          )
        }
      </Loading>
    </Shell>
  )
}
