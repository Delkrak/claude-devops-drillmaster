import { useState } from 'react'
import { api, usePolled } from '../api'
import { href } from '../router'
import type { ChangeRow } from '../types'
import { ChangeItem, ChangeList, DetailLabel, DetailPara, EditLine, Edits } from '../ui/change/List'
import { Empty } from '../ui/Empty'
import { Loading } from '../ui/Loading'
import { Shell } from '../ui/Shell'
import { Tip } from '../ui/workflow/Tip'
import { ProjectNav } from './ProjectNav'

const MEASURE_IN_WORDS: Record<string, string> = {
  owner_friction_per_item: 'your step-ins per work item',
  gate_rejections_per_item: 'gates sent back per work item',
  review_rounds_per_item: 'review rounds per work item',
  minutes_per_item: 'minutes per work item',
  tool_calls_per_item: 'tool calls per work item',
}

const formatNumber = (value: number | null) => (value === null ? '–' : String(Math.round(value * 100) / 100))

const verdictWord = (change: ChangeRow) => change.outcome ?? 'not measured'

function verdictTip(change: ChangeRow) {
  const baseline = `baseline ${formatNumber(change.before)} ± ${formatNumber(change.before_sd)} (SD)${change.before_items !== null ? `, from ${change.before_items} work item${change.before_items === 1 ? '' : 's'}` : ''}`
  if (change.outcome === 'insufficient data') return `n = ${change.counted} of ${change.judge_after} · ${baseline}`
  if (change.outcome === null) return 'no measure set for this change'
  return `n = ${change.counted} · ${baseline}${change.outcome === 'below target' ? ' · target not met' : ''}`
}

function measureHeader(changes: readonly ChangeRow[]) {
  const measureNames = [...new Set(changes.flatMap((change) => (change.measure ? [change.measure] : [])))]
  const measureInWords = measureNames.length === 1 ? (MEASURE_IN_WORDS[measureNames[0]!] ?? measureNames[0]!) : 'the measure'
  // Every measure Drillmaster has is lower-is-better.
  return `${measureInWords} · lower is better`
}

export function ChangesPage({ projectId, at }: { projectId: string; at: string | null }) {
  const loaded = usePolled(() => api.changes(projectId, at), `${projectId}@${at ?? 'now'}`, at ? null : undefined)
  const [openVersions, setOpenVersions] = useState<ReadonlySet<string>>(new Set())
  const toggleVersion = (version: string) =>
    setOpenVersions((current) => {
      const next = new Set(current)
      if (!next.delete(version)) next.add(version)
      return next
    })
  return (
    <Shell title="Changes" aside={<ProjectNav projectId={projectId} at={at} nowHref={href.changes(projectId)} currentPage="changes" />}>
      <Loading loaded={loaded}>
        {(changes) =>
          changes.length === 0 ? (
            <Empty>No changes to the workflow yet.</Empty>
          ) : (
            <ChangeList measure={measureHeader(changes)}>
              {changes.map((change) => (
                <ChangeItem
                  key={change.version}
                  version={change.version}
                  change={change.change}
                  before={formatNumber(change.before)}
                  after={formatNumber(change.after)}
                  verdict={verdictWord(change)}
                  tip={verdictTip(change)}
                  tone={change.outcome === 'significant' ? 'helped' : change.outcome === 'below target' || change.outcome === 'not significant' ? 'notProven' : 'tooEarly'}
                  open={openVersions.has(change.version)}
                  onToggle={() => toggleVersion(change.version)}
                >
                  <DetailLabel>what changed</DetailLabel>
                  <DetailPara>{change.change}</DetailPara>
                  {change.purpose && (
                    <>
                      <DetailLabel>why it was made</DetailLabel>
                      <DetailPara>{change.purpose}</DetailPara>
                    </>
                  )}
                  {change.edits.length > 0 && (
                    <>
                      <DetailLabel>in the workflow</DetailLabel>
                      <Edits>
                        {change.edits.map((edit) => (
                          <EditLine key={`${edit.what}-${edit.ref}`} what={edit.what} refName={edit.was ? `${edit.ref} (was ${edit.was.replace(/^step /, '')})` : edit.ref} name={edit.name} />
                        ))}
                      </Edits>
                    </>
                  )}
                </ChangeItem>
              ))}
            </ChangeList>
          )
        }
      </Loading>
      <Tip />
    </Shell>
  )
}
