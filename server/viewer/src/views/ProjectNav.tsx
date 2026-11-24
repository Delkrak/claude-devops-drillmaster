import { api } from '../api'
import { href } from '../router'
import { FindBox, HeaderLink, MomentLabel } from '../ui/Shell'

const issueNumberOf = (issue: string) => /^#?(\d+)\b/.exec(issue)?.[1] ?? null

export function ProjectNav({ projectId, at, version, nowHref, currentPage }: { projectId: string; at: string | null; version?: string; nowHref: string; currentPage: 'workflow' | 'workItems' | 'workItem' | 'changes' | 'complaints' }) {
  const hrefOfWorkItem = async (number: string) => {
    const foundItem = (await api.workItems(projectId, at)).items.find((item) => issueNumberOf(item.issue) === number)
    return foundItem ? href.workItem(projectId, foundItem.work_item_id, at) : null
  }
  return (
    <>
      {at && <MomentLabel at={at} version={version} nowHref={nowHref} />}
      {currentPage !== 'workflow' && <HeaderLink to={href.workflow(projectId, at)}>workflow</HeaderLink>}
      {currentPage !== 'workItems' && <HeaderLink to={href.workItems(projectId, at)}>work items</HeaderLink>}
      {currentPage !== 'changes' && <HeaderLink to={href.changes(projectId, at)}>changes</HeaderLink>}
      {currentPage !== 'complaints' && <HeaderLink to={href.complaints(projectId, at)}>complaints</HeaderLink>}
      <FindBox hrefOfWorkItem={hrefOfWorkItem} />
    </>
  )
}
