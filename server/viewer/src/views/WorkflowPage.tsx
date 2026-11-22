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

type PickerState = { title: string; items: { label: string; to: string }[]; point: { x: number; y: number } }

export function WorkflowPage({ projectId, at }: { projectId: string; at: string | null }) {
  const loaded = usePolled(() => api.workflowPage(projectId, at), `${projectId}@${at ?? 'now'}`, at ? null : undefined)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const closePicker = useCallback(() => setPicker(null), [])
  const openItems: OpenItems = (title, items, point) => {
    const distinctItems = [...new Map(items.map((item) => [item.work_item_id, item])).values()]
    if (distinctItems.length === 1) window.location.hash = href.workItem(projectId, distinctItems[0]!.work_item_id, at)
    else if (distinctItems.length > 1) setPicker({ title, point, items: distinctItems.map((item) => ({ label: item.issue, to: href.workItem(projectId, item.work_item_id, at) })) })
  }
  const openDelivered = () => (window.location.hash = href.workItems(projectId, at))
  const version = loaded.status === 'ready' ? loaded.data.workflow_version : undefined
  return (
    <Shell title="Workflow" aside={<ProjectNav projectId={projectId} at={at} version={version} nowHref={href.workflow(projectId)} currentPage="workflow" />}>
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
      {picker && <Picker title={picker.title} items={picker.items} point={picker.point} onClose={closePicker} />}
    </Shell>
  )
}
