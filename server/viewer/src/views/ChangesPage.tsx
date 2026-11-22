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

const MEASURE_WORDS: Record<string, string> = {
  owner_friction_per_item: 'your step-ins per work item',
  gate_rejections_per_item: 'gates sent back per work item',
  review_rounds_per_item: 'review rounds per work item',
  minutes_per_item: 'minutes per work item',
  tool_calls_per_item: 'tool calls per work item',
}

const number = (value: number | null) => (value === null ? '–' : String(Math.round(value * 100) / 100))

const verdictWord = (change: ChangeRow) => change.outcome ?? 'not measured'

/**
 * What the verdict rests on, in standard notation. Drillmaster's rule: significant when the mean
 * since the change is more than one standard deviation of the baseline below it, and on target.
 */
function verdictTip(change: ChangeRow) {
  const baseline = `baseline ${number(change.before)} ± ${number(change.before_sd)} (SD)`
  if (change.outcome === 'insufficient data') return `n = ${change.counted} of ${change.judge_after} · ${baseline}`
  if (change.outcome === null) return 'no measure set for this change'
  return `n = ${change.counted} · ${baseline}${change.outcome === 'below target' ? ' · target not met' : ''}`
}

/** What the numbers measure, and which way is better; every measure is lower-is-better. */
function measureHeader(changes: readonly ChangeRow[]) {
  const measures = [...new Set(changes.flatMap((change) => (change.measure ? [change.measure] : [])))]
  const words = measures.length === 1 ? (MEASURE_WORDS[measures[0]!] ?? measures[0]!) : 'the measure'
  return `${words} · lower is better`
}

/** Every change to the workflow, latest first: its measure before → after; open, why it was made and what it changed. */
export function ChangesPage({ id, at }: { id: string; at: string | null }) {
  const loaded = usePolled(() => api.changes(id, at), `${id}@${at ?? 'now'}`, at ? null : undefined)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (version: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(version)) next.add(version)
      return next
    })
  return (
    <Shell title="Changes" aside={<ProjectNav id={id} at={at} nowHref={href.changes(id)} here="changes" />}>
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
                  before={number(change.before)}
                  after={number(change.after)}
                  verdict={verdictWord(change)}
                  tip={verdictTip(change)}
                  tone={change.outcome === 'significant' ? 'helped' : change.outcome === 'below target' || change.outcome === 'not significant' ? 'notProven' : 'tooEarly'}
                  open={open.has(change.version)}
                  onToggle={() => toggle(change.version)}
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
