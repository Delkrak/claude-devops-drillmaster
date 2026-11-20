import { api, usePolled } from '../api'
import { href } from '../router'
import { dayAndTime } from '../time'
import { Empty } from '../ui/Empty'
import { ItemList, ItemRow } from '../ui/item/List'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'
import { Tip } from '../ui/workflow/Tip'
import { ProjectNav } from './ProjectNav'

/** Every work item, latest first: where each is, and how often Owner stepped in. */
export function WorkItemsPage({ id, at }: { id: string; at: string | null }) {
  const loaded = usePolled(() => api.workItems(id, at), `${id}@${at ?? 'now'}`, at ? null : undefined)
  return (
    <Shell title="Work items" aside={<ProjectNav id={id} at={at} nowHref={href.workItems(id)} here="workItems" />}>
      <Loading loaded={loaded}>
        {(items) =>
          items.length === 0 ? (
            <Empty>No work items yet.</Empty>
          ) : (
            <ItemList label="work items">
              {items.map((item) => (
                <ItemRow
                  key={item.work_item_id}
                  to={href.workItem(id, item.work_item_id, at)}
                  issue={item.issue}
                  kind={item.kind}
                  where={item.status === 'delivered' ? 'delivered' : item.at_step ? `at ${item.at_step}` : `started ${dayAndTime(item.started_at)}`}
                  delivered={item.status === 'delivered'}
                  friction={item.friction}
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
