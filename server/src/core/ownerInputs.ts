import type { DrillmasterEvent, FrictionPlaced, WorkTrace } from './events.js'

/** What an Owner input led to: starting or resuming a work item, a retrospective, or none of those. */
export type OwnerInputRole = 'start' | 'resume' | 'retrospective' | 'input'

export interface OwnerInput {
  event_id: string
  at: string
  session_id: string
  prompt: string
  role: OwnerInputRole
  /** The work item it belongs to; none for a retrospective, or outside a work item. */
  work_item_id: string | null
  stage: number | null
  step_guid: string | null
  after_delivery: boolean
  /** Whether Agent changed the work after it, before Owner's next input in the session. */
  changed_work_after: boolean
}

export interface FrictionJudgement {
  event: string
  friction: boolean
  why: string
}

const TAKE_UP_TOOL = /(?:^|__)(work_start|work_resume)$/
const RETROSPECTIVE_TOOL = /(?:^|__)workflow_retrospective$/
/** The Drillmaster calls that act, so they tell what an input led to; reading the workflow or a status does not. */
const ACTING_DRILLMASTER_TOOL = /(?:^|__)(?!workflow_get$|work_status$)(work_\w+|workflow_\w+)$/
/** Tools that change the work, so an input after delivery that one follows corrected it. */
const WORK_CHANGING_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell)$/

interface Open {
  input: OwnerInput
  takesUp?: 'start' | 'resume'
}

/**
 * Owner's chat prompts, each where it belongs: an input after which Agent's next Drillmaster call
 * is work_start or work_resume belongs to that work item, as its start or resume; one after which it
 * is workflow_retrospective belongs to the retrospective; any other belongs to the work item the
 * session is on.
 */
export function ownerInputsOf(events: readonly DrillmasterEvent[]): OwnerInput[] {
  const inputs: OwnerInput[] = []
  const openBySession = new Map<string, Open>()
  const deliveredItems = new Set<string>()
  const settle = (sessionId: string) => openBySession.delete(sessionId)
  const latestBySession = new Map<string, OwnerInput>()
  for (const event of events) {
    if (event.type === 'work_item_delivered') deliveredItems.add(event.work_item_id)
    if (event.type === 'session_bound') {
      const open = openBySession.get(event.session_id)
      if (open?.takesUp) {
        open.input.work_item_id = event.work_item_id
        open.input.after_delivery = deliveredItems.has(event.work_item_id)
        settle(event.session_id)
      }
      continue
    }
    if (event.type !== 'work_trace') continue
    if (event.hook === 'UserPromptSubmit') {
      const input: OwnerInput = {
        event_id: event.id,
        at: event.at,
        session_id: event.session_id,
        prompt: event.prompt ?? '',
        role: 'input',
        work_item_id: event.work_item_id,
        stage: event.stage,
        step_guid: event.step_guid ?? null,
        after_delivery: event.work_item_id !== null && deliveredItems.has(event.work_item_id),
        changed_work_after: false,
      }
      inputs.push(input)
      openBySession.set(event.session_id, { input })
      latestBySession.set(event.session_id, input)
      continue
    }
    if (event.hook === 'PostToolUse' && WORK_CHANGING_TOOLS.test(event.tool ?? '')) {
      const latest = latestBySession.get(event.session_id)
      if (latest) latest.changed_work_after = true
    }
    const open = openBySession.get(event.session_id)
    if (!open || open.takesUp || !event.tool || !ACTING_DRILLMASTER_TOOL.test(event.tool)) continue
    const takeUp = TAKE_UP_TOOL.exec(event.tool)?.[1]
    if (takeUp) {
      open.input.role = takeUp === 'work_start' ? 'start' : 'resume'
      open.takesUp = open.input.role as 'start' | 'resume'
      // The session is bound before the PostToolUse trace of a take-up, so the trace names the work item.
      if (event.hook === 'PostToolUse' && event.work_item_id) {
        open.input.work_item_id = event.work_item_id
        open.input.after_delivery = deliveredItems.has(event.work_item_id)
        settle(event.session_id)
      }
    } else {
      if (RETROSPECTIVE_TOOL.test(event.tool)) Object.assign(open.input, { role: 'retrospective', work_item_id: null, after_delivery: false })
      settle(event.session_id)
    }
  }
  return inputs
}

/**
 * Whether an input counts as friction: as the friction judge decided, or, until it has, by what it
 * led to. A start or resume is not; an input during the work item is; one after delivery is when
 * Agent then changed the work.
 */
export function isFriction(input: OwnerInput, judgements: ReadonlyMap<string, FrictionJudgement>) {
  const judged = judgements.get(input.event_id)
  if (judged) return judged.friction
  if (input.role !== 'input') return false
  return !input.after_delivery || input.changed_work_after
}

export function frictionJudgementsOf(events: readonly DrillmasterEvent[]) {
  const judgements = new Map<string, FrictionJudgement>()
  for (const event of events) if (event.type === 'owner_inputs_judged') for (const judgement of event.inputs) judgements.set(judgement.event, judgement)
  return judgements
}

/** Where Drillmaster 0.3 placed each input its friction judge called friction: the step that should have caught it. */
export function frictionPlacementsOf(events: readonly DrillmasterEvent[]) {
  const placementByEventId = new Map<string, FrictionPlaced['inputs'][number]>()
  for (const event of events) if (event.type === 'friction_placed') for (const placement of event.inputs) placementByEventId.set(placement.event, placement)
  return placementByEventId
}
