import type { DrillmasterEvent } from '../../src/core/events.js'
import { averageMeasure, measureDeliveredItems } from '../../src/core/measures.js'
import { foldState } from '../../src/core/state.js'

export interface Check {
  name: string
  ok: boolean
  detail: string
  doesNotFailRun?: boolean
}

export interface RunFacts {
  ownerMessages: number
  ownerQuestions?: number
  expectsLateStart?: boolean
  /** The commit subjects on the git store's main branch, when the run used one. */
  storeCommits?: string[]
  issues: number
  retros: number
}

export function checkRun(events: readonly DrillmasterEvent[], facts: RunFacts): { checks: Check[]; metrics: Record<string, unknown> } {
  const state = foldState(events)
  const items = Object.values(state.workItems)
  const delivered = items.filter((workItem) => workItem.status === 'delivered')
  const traces = events.filter((e) => e.type === 'work_trace')
  const prompts = traces.filter((e) => e.type === 'work_trace' && e.hook === 'UserPromptSubmit')
  const verdicts = events.filter((e): e is Extract<DrillmasterEvent, { type: 'gate_verdict' }> => e.type === 'gate_verdict')
  const retros = events.filter((e) => e.type === 'retrospective_ran')
  const changes = events.filter((e): e is Extract<DrillmasterEvent, { type: 'workflow_changed' }> => e.type === 'workflow_changed')
  const storedText = JSON.stringify(events)
  const leakedToken =
    /"(?:agent_)?token\\?"\s*:\s*\\?"(?!\[redacted\])[A-Za-z0-9_-]{16,}/.test(storedText) || /agent_token:\s*(?!\[redacted\])[A-Za-z0-9_-]{16,}/.test(storedText)
  const decidedThroughQuestion = events.some((event) => (event.type === 'owner_decided' || event.type === 'gate_verdict' || event.type === 'late_start_judged') && event.via === 'question')

  const deliveredMeasures = measureDeliveredItems(events)
  const firstRetroAt = facts.retros > 0 ? (retros[0]?.at ?? '') : ''
  const deliveredBeforeRetro = deliveredMeasures.filter((item) => item.delivered_at <= firstRetroAt)
  const deliveredAfterRetro = deliveredMeasures.filter((item) => item.delivered_at > firstRetroAt)
  const correctionsBefore = averageMeasure(deliveredBeforeRetro, 'owner_corrections_per_item')
  const correctionsAfter = averageMeasure(deliveredAfterRetro, 'owner_corrections_per_item')

  const checks: Check[] = [
    { name: 'workflow set up from the objective', ok: state.initialized, detail: `version ${state.workflow?.version ?? 'none'}` },
    { name: 'every issue became a work item', ok: items.length >= facts.issues, detail: `${items.length} work items for ${facts.issues} issues` },
    { name: 'every work item delivered', ok: delivered.length >= facts.issues, detail: `${delivered.length}/${facts.issues} delivered` },
    {
      name: 'both post mortems for every delivered item',
      ok: delivered.every((workItem) => workItem.post_mortems.includes('agent') && workItem.post_mortems.includes('drillmaster')),
      detail: delivered.map((workItem) => `${workItem.work_item_id}: ${workItem.post_mortems.join('+') || 'none'}`).join(', '),
    },
    { name: 'every session bound to its work item', ok: items.every((workItem) => workItem.sessions.length > 0), detail: items.map((workItem) => `${workItem.work_item_id}: ${workItem.sessions.length}`).join(', ') },
    { name: "Owner's words recorded as work traces", ok: prompts.length >= facts.ownerMessages, detail: `${prompts.length} recorded, ${facts.ownerMessages} sent` },
    { name: 'tool calls traced to work items', ok: delivered.every((workItem) => workItem.traces > 0), detail: delivered.map((workItem) => `${workItem.work_item_id}: ${workItem.traces}`).join(', ') },
    {
      name: 'every rejection cites a rule or Owner',
      ok: verdicts.filter((verdict) => !verdict.accepted).every((verdict) => verdict.rule !== null || verdict.by === 'owner' || verdict.by === 'agent'),
      detail: `${verdicts.length} verdicts, ${verdicts.filter((verdict) => !verdict.accepted).length} rejections`,
    },
    { name: "Agent's token never stored", ok: !leakedToken, detail: leakedToken ? 'a raw token is in the events' : 'only hashes and [redacted]' },
  ]
  const workflowStages = state.workflow?.stages ?? []
  checks.push({
    name: 'every work stage has a work step with an instruction',
    ok: workflowStages.every((stage) => stage.steps.length > 0 && stage.steps.every((step) => step.instruction.trim() !== '')),
    detail: workflowStages.map((stage) => `${stage.name}: ${stage.steps.length} steps`).join(', ') || 'no stages',
  })
  const missingWorkReports = events.filter(
    (event) => event.type === 'work_reported' && event.kind === 'impediment' && /workflow.{0,40}(missing|lacks|has no|had no|no step)|no (work )?step (for|to)/i.test(event.text),
  )
  checks.push({
    name: 'no Agent reports the workflow missing its work',
    ok: missingWorkReports.length === 0,
    detail: missingWorkReports.map((event) => (event.type === 'work_reported' ? event.text.slice(0, 120) : '')).join(' | ') || 'none',
    doesNotFailRun: true,
  })
  const workflowMetrics = state.workflow?.metrics ?? []
  if (workflowMetrics.length > 0) {
    const recorded = events.filter((event) => event.type === 'metric_recorded')
    checks.push({ name: 'metrics recorded', ok: recorded.length > 0, detail: `${recorded.length} recorded for ${workflowMetrics.map((metric) => metric.name).join(', ')}` })
  }
  if (facts.expectsLateStart) {
    const judged = events.filter((event) => event.type === 'late_start_judged')
    checks.push({ name: 'a late start was judged', ok: judged.length > 0, detail: judged.map((event) => (event.type === 'late_start_judged' ? `${event.by}: ${event.accepted ? 'approved' : 'rejected'}` : '')).join(', ') || 'none' })
  }
  if (facts.storeCommits) {
    const complete = items.filter((workItem) => workItem.status === 'delivered' && workItem.post_mortems.length === 2)
    const squashed = facts.storeCommits.filter((subject) => /^wi_\w+ \(/.test(subject))
    checks.push({
      name: 'the store holds one squash commit per complete work item',
      ok: squashed.length === complete.length && complete.every((workItem) => squashed.some((subject) => subject.startsWith(`${workItem.work_item_id} `))),
      detail: `${squashed.length} squash commits for ${complete.length} complete work items`,
    })
  }
  if (facts.retros > 0) {
    checks.push(
      { name: 'workflow retrospective ran', ok: retros.length >= facts.retros, detail: `${retros.length} ran` },
      { name: 'the workflow grew from workflow_0', ok: changes.length > 0, detail: `now version ${state.workflow?.version}` },
      {
        name: 'Owner decided through AskUserQuestion',
        ok: decidedThroughQuestion,
        detail: `${facts.ownerQuestions ?? 0} questions asked; ${events.filter((event) => event.type === 'owner_asked').length} recorded as asked`,
      },
      {
        name: 'each change opened an experiment with a baseline',
        ok: changes.every((change) => change.workflow.experiments.every((experiment) => typeof experiment.baseline === 'number')) && (state.workflow?.experiments.length ?? 0) > 0,
        detail: (state.workflow?.experiments ?? []).map((experiment) => `#${experiment.id} ${experiment.measure} baseline ${experiment.baseline}`).join('; '),
      },
      {
        name: 'Owner corrections per item fell after the retrospective',
        ok: correctionsBefore !== null && correctionsAfter !== null && correctionsAfter < correctionsBefore,
        detail: `before ${correctionsBefore ?? 'n/a'} (${deliveredBeforeRetro.length} items), after ${correctionsAfter ?? 'n/a'} (${deliveredAfterRetro.length} items)`,
        doesNotFailRun: true,
      },
    )
  }
  return {
    checks,
    metrics: {
      events: events.length,
      traces: traces.length,
      work_items: items.length,
      verdicts: verdicts.map((verdict) => `${verdict.stage}.${verdict.step} ${verdict.by} ${verdict.accepted ? 'accepted' : 'rejected'}`),
      workflow_version: state.workflow?.version,
      corrections_before: correctionsBefore,
      corrections_after: correctionsAfter,
      per_item: deliveredMeasures.map((item) => ({ id: item.work_item_id, issue: item.issue, ...item.values })),
    },
  }
}
