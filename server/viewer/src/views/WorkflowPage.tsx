import { api, usePolled } from '../api'
import { Loading } from '../ui/Loading'
import { href } from '../router'
import { MomentLabel, Shell } from '../ui/Shell'
import { Key } from '../ui/workflow/Key'
import { FirstScreen, PipelineColumn } from '../ui/workflow/layout'
import { Tip } from '../ui/workflow/Tip'
import { Overview } from './workflow/Overview'
import { PipelineEnd } from './workflow/PipelineEnd'
import { StageWalk } from './workflow/StageWalk'

/**
 * The pipeline, where the work items are, and where the friction is: the overview on a screen of its
 * own, then each stage's steps as Owner scrolls. Follows the project live, or shows one moment (`at`).
 */
export function WorkflowPage({ id, at }: { id: string; at: string | null }) {
  const loaded = usePolled(() => api.workflow(id, at), `${id}@${at ?? 'now'}`, at ? null : undefined)
  return (
    <Shell title="Workflow" aside={at && loaded.status === 'ready' ? <MomentLabel at={loaded.data.at} version={loaded.data.workflow_version} nowHref={href.workflow(id)} /> : undefined}>
      <Loading loaded={loaded}>
        {(page) => (
          <PipelineColumn>
            <FirstScreen testId="first-screen">
              <Overview page={page} />
            </FirstScreen>
            {page.stages.map((stage) => (
              <StageWalk key={stage.guid} stage={stage} />
            ))}
            <PipelineEnd page={page} />
          </PipelineColumn>
        )}
      </Loading>
      <Key />
      <Tip />
    </Shell>
  )
}
