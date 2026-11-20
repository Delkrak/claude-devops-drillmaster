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
import { Route, type Opened } from './item/Route'
import type { Depth } from './item/StepDetail'
import { ProjectNav } from './ProjectNav'

function State({ page }: { page: Page }) {
  if (page.delivered) {
    return (
      <>
        delivered <Strong>{dayAndTime(page.delivered.at)}</Strong>
      </>
    )
  }
  const here = page.stages.flatMap((stage) => stage.steps).find((step) => step.status === 'here')
  return here ? (
    <>
      in progress at <Strong>{here.name}</Strong>
    </>
  ) : (
    <>waiting to be delivered</>
  )
}

/** The key names only what this work item's route draws. */
function marksOf(page: Page): KeyMark[] {
  const steps = page.stages.flatMap((stage) => stage.steps)
  const verdicts = steps.flatMap((step) => step.happened.verdicts)
  const has: Record<KeyMark, boolean> = {
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
  return (Object.keys(has) as KeyMark[]).filter((mark) => has[mark])
}

/**
 * What happened to one work item: its route along the workflow it runs on, lit where it went and
 * faded where it skipped, with Owner's step-ins at the step that should have caught them. A step
 * opens one level at a time: what happened, the evidence, every tool call.
 */
export function WorkItemPage({ id, workItemId, at }: { id: string; workItemId: string; at: string | null }) {
  const loaded = usePolled(() => api.workItem(id, workItemId, at), `${id}/${workItemId}@${at ?? 'now'}`, at ? null : undefined)
  const [opened, setOpened] = useState<Opened>(new Map())
  const onOpen = (key: string, depth: Depth | null) =>
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
      aside={<ProjectNav id={id} at={at} version={page?.workflow_version} nowHref={href.workItem(id, workItemId)} here="workItem" />}
    >
      <Loading loaded={loaded}>
        {(data) => (
          <RouteColumn>
            <ItemTitle issue={data.issue} kind={data.kind} state={<State page={data} />} description={data.description} />
            <Route page={data} opened={opened} onOpen={onOpen} />
          </RouteColumn>
        )}
      </Loading>
      {page && <Key marks={marksOf(page)} />}
      <Tip />
    </Shell>
  )
}
