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

/** The verdict in words, for the explanation under the numbers. */
function verdictWords(change: ChangeRow) {
  const measure = change.measure ? (MEASURE_WORDS[change.measure] ?? change.measure) : 'its measure'
  const numbers = `${measure}: ${number(change.before)} before, ${number(change.after)} over ${change.counted} work item${change.counted === 1 ? '' : 's'} since`
  if (change.verdict === 'keep') return `helped. ${numbers}`
  if (change.verdict === 'rethink') return `not proven: the difference is within chance, or misses its target. ${numbers}`
  if (change.verdict === 'running') return `too early: ${change.counted} of ${change.judge_after} work items. ${numbers}`
  return 'not measured'
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
            <ChangeList>
              {changes.map((change) => (
                <ChangeItem
                  key={change.version}
                  version={change.version}
                  change={change.change}
                  before={number(change.before)}
                  after={number(change.after)}
                  tip={verdictWords(change)}
                  counted={change.verdict === 'running' ? `${change.counted} of ${change.judge_after} items` : `${change.counted} items`}
                  worse={change.before !== null && change.after !== null && change.after > change.before}
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
