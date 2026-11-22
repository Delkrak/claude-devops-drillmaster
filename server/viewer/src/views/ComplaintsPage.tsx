import { useState } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { dayAndTime } from '../time'
import type { Complaint } from '../types'
import { ComplaintGroup, ComplaintLine, ComplaintList } from '../ui/complaint/List'
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

/** What's wrong in Drillmaster: its tools, most complained about first; open, every complaint in full. */
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
    complaints.map((complaint, index) => (
      <ComplaintLine key={index} who={WHO[complaint.source]} issue={complaint.issue} to={href.workItem(id, complaint.work_item_id, at)} when={dayAndTime(complaint.at)} text={complaint.text} />
    ))
  return (
    <Shell title="Complaints about Drillmaster" aside={<ProjectNav id={id} at={at} nowHref={href.complaints(id)} here="complaints" />}>
      <Loading loaded={loaded}>
        {(page) =>
          page.tools.length === 0 && page.uncovered.length === 0 ? (
            <Empty>No complaints about Drillmaster yet.</Empty>
          ) : (
            <ComplaintList>
              {page.tools.map(({ tool, complaints }) => (
                <ComplaintGroup key={tool} name={tool} count={complaints.length} latest={complaints[0]!.text} open={open.has(tool)} onToggle={() => toggle(tool)}>
                  {lines(complaints)}
                </ComplaintGroup>
              ))}
              {page.uncovered.length > 0 && (
                <ComplaintGroup name={UNCOVERED} gap count={page.uncovered.length} latest={page.uncovered[0]!.text} open={open.has(UNCOVERED)} onToggle={() => toggle(UNCOVERED)}>
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
