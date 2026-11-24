import type { DrillmasterEvent } from '../../src/core/events.js'
import { averageMeasure, measureDeliveredItems } from '../../src/core/measures.js'
import { foldState } from '../../src/core/state.js'
import { resolveRef } from '../../src/core/refs.js'
import { applicabilityOf, workflowOfWorkItem } from '../../src/core/work.js'
import { refOfGuid } from '../../src/core/refs.js'
import { AT_START } from '../../src/core/workflow.js'

export interface Check {
  name: string
  ok: boolean
  detail: string
  doesNotFailRun?: boolean
}

export interface RunFacts {
  ownerMessages: number
  ownerQuestions?: number
  /** The commit subjects on the Drillmaster repository's main branch. */
  repositoryCommits?: string[]
  issues: number
  retros: number
  /** Issues done over several sittings, each a fresh session. */
  phasedIssues?: { issue: string; phases: number }[]
  /** Drillmaster's Owner gate questions Owner was asked, and how many showed what Owner approves beside them. */
  ownerGates?: { asked: number; withPreview: number }
  expects?: {
    update?: boolean
    skip?: boolean
    input?: string
    /** Steps skipped because their if wasn't met, and no work item through a step it doesn't meet. */
    condition_skip?: boolean
    /** A tool capture of this name kept output that a gate links. */
    capture?: string
    /** Drillmaster's post mortems judged the workflow's measures. */
    measures_judged?: boolean
  }
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
  const decidedThroughQuestion = events.some((event) => (event.type === 'owner_decided' || event.type === 'gate_verdict' || event.type === 'step_skip_decided') && event.via === 'question')

  const deliveredMeasures = measureDeliveredItems(events)
  const firstRetroAt = facts.retros > 0 ? (retros[0]?.at ?? '') : ''
  const deliveredBeforeRetro = deliveredMeasures.filter((item) => item.delivered_at <= firstRetroAt)
  const deliveredAfterRetro = deliveredMeasures.filter((item) => item.delivered_at > firstRetroAt)
  const correctionsBefore = averageMeasure(deliveredBeforeRetro, 'owner_friction_per_item')
  const correctionsAfter = averageMeasure(deliveredAfterRetro, 'owner_friction_per_item')

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
  // An input added by the last retrospective has had no work item to be set on.
  const dueInputs = items.flatMap((workItem) => {
    const workflow = workflowOfWorkItem(state, workItem)
    return workflow.inputs
      .filter((input) => input.set_at === AT_START || workItem.passed_step_guids.includes(resolveRef(workflow, input.set_at, { impliedKind: 'step' }).guid!))
      .map((input) => input.name)
  })
  if (dueInputs.length > 0) {
    const set = events.filter((event) => event.type === 'input_set')
    checks.push({ name: 'work item inputs set', ok: set.length > 0, detail: `${set.length} set; ${new Set(dueInputs).size} inputs were due at start or at steps work items passed` })
  }
  for (const phased of facts.phasedIssues ?? []) {
    const item = items.find((workItem) => workItem.issue.includes(phased.issue))
    checks.push({
      name: `issue ${phased.issue} was taken up again in each later sitting`,
      ok: item !== undefined && item.resumed >= phased.phases - 1 && item.sessions.length >= phased.phases,
      detail: item ? `${item.resumed} resumes, ${item.sessions.length} sessions, for ${phased.phases} sittings` : 'no work item',
    })
  }
  if (facts.expects?.update) {
    const updates = events.filter((event): event is Extract<DrillmasterEvent, { type: 'work_item_updated' }> => event.type === 'work_item_updated')
    checks.push({
      name: 'an open work item updated to a newer workflow at a step that allows it',
      ok: updates.length > 0,
      detail: updates.map((event) => `${event.work_item_id}: ${event.from_version} -> ${event.to_version}, kept ${event.kept.length}, resumes at ${event.resumes_at.stage ?? '-'}.${event.resumes_at.step ?? '-'}`).join('; ') || 'none',
      // An update needs the workflow to change while a work item is open, between its sittings.
      doesNotFailRun: !changes.some((change) => items.some((workItem) => workItem.started_at < change.at && events.some((event) => event.type === 'work_item_resumed' && event.work_item_id === workItem.work_item_id && event.at > change.at))),
    })
  }
  if (facts.expects?.skip) {
    const skips = events.filter((event): event is Extract<DrillmasterEvent, { type: 'step_skip_decided' }> => event.type === 'step_skip_decided')
    checks.push({ name: 'a skippable step was skipped', ok: skips.some((skip) => skip.accepted), detail: skips.map((skip) => `${skip.work_item_id} ${skip.stage}.${skip.step} ${skip.accepted ? 'skipped' : 'rejected'} by ${skip.by}`).join('; ') || 'none' })
  }
  if (facts.expects?.condition_skip) {
    const conditionSkips = events.filter((event) => event.type === 'step_skip_decided' && event.by === 'condition')
    const wrongPaths = delivered.flatMap((workItem) => {
      const workflow = workflowOfWorkItem(state, workItem)
      const inputs = Object.fromEntries(Object.entries(workItem.inputs).map(([name, input]) => [name, input.value]))
      return workItem.passed_step_guids.flatMap((guid) => {
        const step = refOfGuid(workflow, guid)
        const [stage, stepNumber] = (step?.name ?? '').split('.').map(Number)
        return step && applicabilityOf(workflow, stage!, stepNumber!, inputs).applies === false ? [`${workItem.issue} passed step ${step.name}`] : []
      })
    })
    checks.push({ name: 'steps were skipped by their if', ok: conditionSkips.length > 0, detail: `${conditionSkips.length} skipped by condition` })
    checks.push({ name: 'no work item went through a step whose if it does not meet', ok: wrongPaths.length === 0, detail: wrongPaths.join('; ') || 'none' })
  }
  if (facts.expects?.capture) {
    const name = facts.expects.capture
    const captured = events.filter((event) => event.type === 'work_trace' && event.captures?.some((capture) => capture.name === name))
    const linked = events.filter((event) => event.type === 'gate_submitted' && event.capture_traces?.length)
    checks.push({ name: `the tool capture "${name}" kept output`, ok: captured.length > 0, detail: `${captured.length} traces` })
    checks.push({ name: 'gates link the captures at their step', ok: linked.length > 0, detail: `${linked.length} gates` })
  }
  if (facts.expects?.measures_judged) {
    const judged = events.filter((event) => event.type === 'post_mortem_written' && event.author === 'drillmaster' && event.measured)
    const occurrences = judged.flatMap((event) => (event.type === 'post_mortem_written' ? (event.measured ?? []).flatMap((judgement) => judgement.occurrences) : []))
    checks.push({ name: "Drillmaster's post mortems judged the measures", ok: judged.length > 0, detail: `${judged.length} work items judged, ${occurrences.length} occurrences` })
  }
  if (facts.ownerGates?.asked) {
    checks.push({ name: 'Owner gates showed what Owner approves beside the question', ok: facts.ownerGates.withPreview === facts.ownerGates.asked, detail: `${facts.ownerGates.withPreview} of ${facts.ownerGates.asked}` })
  }
  if (facts.expects?.input) {
    const input = facts.expects.input
    const without = delivered.filter((workItem) => !workItem.inputs[input])
    checks.push({ name: `every delivered work item has its ${input}`, ok: without.length === 0, detail: delivered.map((workItem) => `${workItem.issue}: ${workItem.inputs[input]?.value ?? 'none'}`).join(', ') })
  }
  if (facts.repositoryCommits) {
    const complete = items.filter((workItem) => workItem.status === 'delivered' && workItem.post_mortems.length === 2)
    const squashed = facts.repositoryCommits.filter((subject) => /^wi_\w+ \(/.test(subject))
    checks.push({
      name: 'the Drillmaster repository holds one squash commit per complete work item',
      ok: squashed.length === complete.length && complete.every((workItem) => squashed.some((subject) => subject.startsWith(`${workItem.work_item_id} `))),
      detail: `${squashed.length} squash commits for ${complete.length} complete work items`,
    })
  }
  if (facts.retros > 0) {
    let earlierIds = new Set(state.versions[0]?.experiments.map((experiment) => experiment.id) ?? [])
    const changeExperiments = changes.map((change) => {
      const opened = change.workflow.experiments.filter((experiment) => !earlierIds.has(experiment.id))
      const ended = [...earlierIds].filter((id) => !change.workflow.experiments.some((experiment) => experiment.id === id))
      earlierIds = new Set(change.workflow.experiments.map((experiment) => experiment.id))
      const ok = opened.length > 0 ? opened.every((experiment) => typeof experiment.baseline === 'number') : ended.length > 0
      const detail = `${change.workflow.version}: ${[...opened.map((experiment) => `opened #${experiment.id} on ${experiment.measure}, baseline ${experiment.baseline}`), ...ended.map((id) => `ended #${id}`)].join(', ') || 'no experiment'}`
      return { ok, detail }
    })
    checks.push(
      { name: 'workflow retrospective ran', ok: retros.length >= facts.retros, detail: `${retros.length} ran` },
      { name: 'the workflow grew from workflow_0', ok: changes.length > 0, detail: `now version ${state.workflow?.version}` },
      {
        name: 'Owner decided through AskUserQuestion',
        ok: decidedThroughQuestion,
        detail: `${facts.ownerQuestions ?? 0} questions asked; ${events.filter((event) => event.type === 'owner_asked').length} recorded as asked`,
      },
      {
        name: 'each change opened an experiment with a baseline, or only ended experiments',
        ok: changeExperiments.length > 0 && changeExperiments.every((change) => change.ok),
        detail: changeExperiments.map((change) => change.detail).join('; '),
      },
      {
        name: "Owner's friction per item fell after the retrospective",
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
