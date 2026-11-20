import { useCallback, useState } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'
import { Key } from '../ui/workflow/Key'
import { FirstScreen, PipelineColumn } from '../ui/workflow/layout'
import { Picker } from '../ui/workflow/Picker'
import { Tip } from '../ui/workflow/Tip'
import { ProjectNav } from './ProjectNav'
import type { OpenItems } from './workflow/describe'
import { Overview } from './workflow/Overview'
import { PipelineEnd } from './workflow/PipelineEnd'
import { StageWalk } from './workflow/StageWalk'

type Picking = { title: string; items: { label: string; to: string }[]; at: { x: number; y: number } }

/**
 * The pipeline, where the work items are, and where the friction is: the overview on a screen of its
 * own, then each stage's steps as Owner scrolls. Follows the project live, or shows one moment (`at`).
 * A work-item box or a ring opens its work item, or a short list of them when it holds several.
 */
export function WorkflowPage({ id, at }: { id: string; at: string | null }) {
  const loaded = usePolled(() => api.workflow(id, at), `${id}@${at ?? 'now'}`, at ? null : undefined)
  const [picking, setPicking] = useState<Picking | null>(null)
  const closePicker = useCallback(() => setPicking(null), [])
  const openItems: OpenItems = (title, items, point) => {
    const distinct = [...new Map(items.map((item) => [item.work_item_id, item])).values()]
    if (distinct.length === 1) window.location.hash = href.workItem(id, distinct[0]!.work_item_id, at)
    else if (distinct.length > 1) setPicking({ title, at: point, items: distinct.map((item) => ({ label: item.issue, to: href.workItem(id, item.work_item_id, at) })) })
  }
  const openDelivered = () => (window.location.hash = href.workItems(id, at))
  const version = loaded.status === 'ready' ? loaded.data.workflow_version : undefined
  return (
    <Shell title="Workflow" aside={<ProjectNav id={id} at={at} version={version} nowHref={href.workflow(id)} here="workflow" />}>
      <Loading loaded={loaded}>
        {(page) => (
          <PipelineColumn>
            <FirstScreen testId="first-screen">
              <Overview page={page} openItems={openItems} openDelivered={openDelivered} />
            </FirstScreen>
            {page.stages.map((stage) => (
              <StageWalk key={stage.guid} stage={stage} openItems={openItems} />
            ))}
            <PipelineEnd page={page} openItems={openItems} openDelivered={openDelivered} />
          </PipelineColumn>
        )}
      </Loading>
      <Key />
      <Tip />
      {picking && <Picker title={picking.title} items={picking.items} at={picking.at} onClose={closePicker} />}
    </Shell>
  )
}
