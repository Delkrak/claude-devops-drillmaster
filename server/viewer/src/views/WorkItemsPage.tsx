import { api, usePolled } from '../api'
import { href } from '../router'
import { dayAndTime } from '../time'
import { Empty } from '../ui/Empty'
import { ItemList, ItemRow } from '../ui/item/List'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'
import { Tip } from '../ui/workflow/Tip'
import { shortOfMeasure, timesWord, toneOfMeasure } from './measures'
import { ProjectNav } from './ProjectNav'

export function WorkItemsPage({ projectId, at }: { projectId: string; at: string | null }) {
  const loaded = usePolled(() => api.workItems(projectId, at), `${projectId}@${at ?? 'now'}`, at ? null : undefined)
  return (
    <Shell title="Work items" aside={<ProjectNav projectId={projectId} at={at} nowHref={href.workItems(projectId)} currentPage="workItems" />}>
      <Loading loaded={loaded}>
        {({ measures, items }) =>
          items.length === 0 ? (
            <Empty>No work items yet.</Empty>
          ) : (
            <ItemList label="work items">
              {items.map((item) => (
                <ItemRow
                  key={item.work_item_id}
                  itemHref={href.workItem(projectId, item.work_item_id, at)}
                  issue={item.issue}
                  kind={item.kind}
                  summary={item.summary}
                  where={item.status === 'delivered' ? 'delivered' : item.at_step ? `at ${item.at_step}` : `started ${dayAndTime(item.started_at)}`}
                  delivered={item.status === 'delivered'}
                  pills={item.marks.map((mark) => ({
                    measure: mark.measure,
                    short: shortOfMeasure(measures, mark.measure),
                    count: mark.count,
                    tone: toneOfMeasure(measures, mark.measure),
                    tip: `${mark.measure} ${timesWord(mark.count)}`,
                  }))}
                />
              ))}
            </ItemList>
          )
        }
      </Loading>
      <Tip />
    </Shell>
  )
}
