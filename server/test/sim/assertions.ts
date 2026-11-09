// What a simulation run must show, read from the server's events. Pure, so it is unit tested too.

import type { DrillmasterEvent } from '../../src/core/events.js'
import { average, measureItems } from '../../src/core/measures.js'
import { foldState } from '../../src/core/state.js'

export interface Check {
  name: string
  ok: boolean
  detail: string
  /** A soft check reports, but does not fail the run: LLM runs vary. */
  soft?: boolean
}

export interface RunFacts {
  /** Messages the harness sent as Owner while a work item was active. */
  ownerMessages: number
  issues: number
  retros: number
}

export function checkRun(events: readonly DrillmasterEvent[], facts: RunFacts): { checks: Check[]; metrics: Record<string, unknown> } {
  const state = foldState(events)
  const items = Object.values(state.workItems)
  const delivered = items.filter((i) => i.status === 'delivered')
  const traces = events.filter((e) => e.type === 'work_trace')
  const prompts = traces.filter((e) => e.type === 'work_trace' && e.hook === 'UserPromptSubmit')
  const verdicts = events.filter((e): e is Extract<DrillmasterEvent, { type: 'gate_verdict' }> => e.type === 'gate_verdict')
  const retros = events.filter((e) => e.type === 'retrospective_ran')
  const changes = events.filter((e): e is Extract<DrillmasterEvent, { type: 'workflow_changed' }> => e.type === 'workflow_changed')
  const raw = JSON.stringify(events)
  const leakedToken = /"(?:agent_)?token\\?"\s*:\s*\\?"(?!\[redacted\])[A-Za-z0-9_-]{16,}/.test(raw)

  const measured = measureItems(events)
  const cut = facts.retros > 0 ? (retros[0]?.at ?? '') : ''
  const before = measured.filter((i) => i.delivered_at <= cut)
  const after = measured.filter((i) => i.delivered_at > cut)
  const corrBefore = average(before, 'owner_corrections_per_item')
  const corrAfter = average(after, 'owner_corrections_per_item')

  const checks: Check[] = [
    { name: 'workflow set up from the objective', ok: state.initialized, detail: `version ${state.workflow?.version ?? 'none'}` },
    { name: 'every issue became a work item', ok: items.length >= facts.issues, detail: `${items.length} work items for ${facts.issues} issues` },
    { name: 'every work item delivered', ok: delivered.length >= facts.issues, detail: `${delivered.length}/${facts.issues} delivered` },
    {
      name: 'both post mortems for every delivered item',
      ok: delivered.every((i) => i.post_mortems.includes('agent') && i.post_mortems.includes('drillmaster')),
      detail: delivered.map((i) => `${i.work_item_id}: ${i.post_mortems.join('+') || 'none'}`).join(', '),
    },
    { name: 'every session bound to its work item', ok: items.every((i) => i.sessions.length > 0), detail: items.map((i) => `${i.work_item_id}: ${i.sessions.length}`).join(', ') },
    { name: "Owner's words recorded as work traces", ok: prompts.length >= facts.ownerMessages, detail: `${prompts.length} recorded, ${facts.ownerMessages} sent` },
    { name: 'tool calls traced to work items', ok: delivered.every((i) => i.traces > 0), detail: delivered.map((i) => `${i.work_item_id}: ${i.traces}`).join(', ') },
    {
      name: 'every rejection cites a rule or Owner',
      ok: verdicts.filter((v) => !v.accepted).every((v) => v.rule !== null || v.by === 'owner' || v.by === 'agent'),
      detail: `${verdicts.length} verdicts, ${verdicts.filter((v) => !v.accepted).length} rejections`,
    },
    { name: "Agent's token never stored", ok: !leakedToken, detail: leakedToken ? 'a raw token is in the events' : 'only hashes and [redacted]' },
  ]
  if (facts.retros > 0) {
    checks.push(
      { name: 'workflow retrospective ran', ok: retros.length >= facts.retros, detail: `${retros.length} ran` },
      { name: 'the workflow grew from workflow_0', ok: changes.length > 0, detail: `now version ${state.workflow?.version}` },
      {
        name: 'each change opened an experiment with a baseline',
        ok: changes.every((c) => c.workflow.experiments.every((x) => typeof x.baseline === 'number')) && (state.workflow?.experiments.length ?? 0) > 0,
        detail: (state.workflow?.experiments ?? []).map((x) => `#${x.id} ${x.measure} baseline ${x.baseline}`).join('; '),
      },
      {
        name: 'Owner corrections per item fell after the retrospective',
        ok: corrBefore !== null && corrAfter !== null && corrAfter < corrBefore,
        detail: `before ${corrBefore ?? 'n/a'} (${before.length} items), after ${corrAfter ?? 'n/a'} (${after.length} items)`,
        soft: true,
      },
    )
  }
  return {
    checks,
    metrics: {
      events: events.length,
      traces: traces.length,
      work_items: items.length,
      verdicts: verdicts.map((v) => `${v.stage}.${v.step} ${v.by} ${v.accepted ? 'accepted' : 'rejected'}`),
      workflow_version: state.workflow?.version,
      corrections_before: corrBefore,
      corrections_after: corrAfter,
      per_item: measured.map((m) => ({ id: m.work_item_id, issue: m.issue, ...m.values })),
    },
  }
}
