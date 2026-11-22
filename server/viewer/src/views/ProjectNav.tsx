import { api } from '../api'
import { href } from '../router'
import { FindBox, HeaderLink, MomentLabel } from '../ui/Shell'

/** A work item's number as written in its issue: "#12 export" is 12. */
export const numberOf = (issue: string) => /^#?(\d+)\b/.exec(issue)?.[1] ?? null

/**
 * The header of a project's pages: the past moment shown, if any, with the way back to now; the ways
 * to the Workflow page, the work items, the changes and the complaints about Drillmaster; and the box that finds a work item by its number.
 */
export function ProjectNav({ id, at, version, nowHref, here }: { id: string; at: string | null; version?: string; nowHref: string; here: 'workflow' | 'workItems' | 'workItem' | 'changes' | 'complaints' }) {
  const find = async (number: string) => {
    const found = (await api.workItems(id, at)).find((item) => numberOf(item.issue) === number)
    return found ? href.workItem(id, found.work_item_id, at) : null
  }
  return (
    <>
      {at && <MomentLabel at={at} version={version} nowHref={nowHref} />}
      {here !== 'workflow' && <HeaderLink to={href.workflow(id, at)}>workflow</HeaderLink>}
      {here !== 'workItems' && <HeaderLink to={href.workItems(id, at)}>work items</HeaderLink>}
      {here !== 'changes' && <HeaderLink to={href.changes(id, at)}>changes</HeaderLink>}
      {here !== 'complaints' && <HeaderLink to={href.complaints(id, at)}>complaints</HeaderLink>}
      <FindBox find={find} />
    </>
  )
}
