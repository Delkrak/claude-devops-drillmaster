import { useState } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import { dayAndTime } from '../time'
import type { WorkItemPage as Page } from '../types'
import { RouteColumn } from '../ui/item/route'
import { ItemTitle, Strong } from '../ui/item/Title'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'
import { Key, type KeyMark } from '../ui/workflow/Key'
import { stopKindOf } from '../ui/workflow/marks'
import { Tip } from '../ui/workflow/Tip'
import { Route, type OpenedDepths } from './item/Route'
import type { DetailDepth } from './item/StepDetail'
import { ProjectNav } from './ProjectNav'

function ItemState({ page }: { page: Page }) {
  if (page.delivered) {
    return (
      <>
        delivered <Strong>{dayAndTime(page.delivered.at)}</Strong>
      </>
    )
  }
  const currentStep = page.stages.flatMap((stage) => stage.steps).find((step) => step.status === 'here')
  return currentStep ? (
    <>
      in progress at <Strong>{currentStep.name}</Strong>
    </>
  ) : (
    <>waiting to be delivered</>
  )
}

function keyMarksOf(page: Page): KeyMark[] {
  const steps = page.stages.flatMap((stage) => stage.steps)
  const verdicts = steps.flatMap((step) => step.happened.verdicts)
  const isDrawn: Record<KeyMark, boolean> = {
    always: steps.some((step) => stopKindOf(step) === 'always'),
    if: steps.some((step) => stopKindOf(step) === 'if'),
    approve: steps.some((step) => stopKindOf(step) === 'approve'),
    review: steps.some((step) => stopKindOf(step) === 'review'),
    passed: verdicts.some((verdict) => verdict.by === 'drillmaster' && verdict.accepted),
    sentBack: verdicts.some((verdict) => verdict.by !== 'agent' && !verdict.accepted),
    skipped: steps.some((step) => step.status === 'skipped'),
    ahead: steps.some((step) => step.status === 'ahead' || step.status === 'here'),
    workItem: false,
    here: steps.some((step) => step.status === 'here'),
    friction: steps.some((step) => step.step_ins.length > 0) || page.step_ins_unplaced.length > 0,
    delivered: page.delivered !== null,
    afterDelivery: page.delivered !== null,
  }
  return (Object.keys(isDrawn) as KeyMark[]).filter((mark) => isDrawn[mark])
}

export function WorkItemPage({ projectId, workItemId, at }: { projectId: string; workItemId: string; at: string | null }) {
  const loaded = usePolled(() => api.workItemPage(projectId, workItemId, at), `${projectId}/${workItemId}@${at ?? 'now'}`, at ? null : undefined)
  const [opened, setOpened] = useState<OpenedDepths>(new Map())
  const onOpen = (key: string, depth: DetailDepth | null) =>
    setOpened((current) => {
      const next = new Map(current)
      if (depth === null) next.delete(key)
      else next.set(key, depth)
      return next
    })
  const page = loaded.status === 'ready' ? loaded.data : null
  return (
    <Shell
      title={page ? `Work item ${page.issue}` : 'Work item'}
      aside={<ProjectNav projectId={projectId} at={at} version={page?.workflow_version} nowHref={href.workItem(projectId, workItemId)} currentPage="workItem" />}
    >
      <Loading loaded={loaded}>
        {(loadedPage) => (
          <RouteColumn>
            <ItemTitle issue={loadedPage.issue} kind={loadedPage.kind} state={<ItemState page={loadedPage} />} description={loadedPage.description} />
            <Route page={loadedPage} opened={opened} onOpen={onOpen} />
          </RouteColumn>
        )}
      </Loading>
      {page && <Key marks={keyMarksOf(page)} />}
      <Tip />
    </Shell>
  )
}
