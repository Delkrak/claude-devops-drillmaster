import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { REPORT_KINDS, type DrillmasterEvent, type GateSubmitted, type NewEvent } from './core/events.js'
import { handleHook, HOOK_EVENTS, type HookPayload } from './core/hooks.js'
import { averageMeasure, BASELINE_WINDOW, MEASURE_NAMES, measureDeliveredItems } from './core/measures.js'
import {
  applyProposal,
  buildPostMortemPrompt,
  buildRetroPrompt,
  deliveredSinceLastRetro,
  InvalidChange,
  POST_MORTEM_REVIEW_KIND,
  readPostMortemAnswer,
  readRetroAnswer,
  RETRO_REVIEW_KIND,
  toRetroView,
} from './core/retro.js'
import { buildGatePrompt, GATE_REVIEW_KIND, InvalidAnswer, readGateAnswer } from './core/review.js'
import { findWorkItemByTokenHash, foldState, viewWorkflow, WorkflowQueryError, workReportsOf, workTracesOf, type ProjectState } from './core/state.js'
import * as views from './core/views.js'
import * as work from './core/work.js'
import { Objective, workflowZero } from './core/workflow.js'
import { projectId as projectIdOf } from './env.js'
import type { Ports } from './ports.js'

const POST_MORTEM_TIMEOUT_MS = 180_000
const RETROSPECTIVE_TIMEOUT_MS = 300_000
const MAX_LAST_REPORTS = 200
const NO_WORKFLOW_YET = 'This project has no workflow yet. Owner sets the objective first (setup).'
const UNKNOWN_TOKEN = 'Unknown token. Use the agent_token that work_report start returned.'

export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export interface DrillmasterOptions {
  recordRawHookPayloads?: boolean
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const WorkflowGetArgs = z
  .object({
    stage: z.number().int().positive().optional(),
    full: z.boolean().optional(),
    version: z.number().int().nonnegative().optional(),
  })
  .strict()

const tokenField = z.string().min(1)
const textField = z.string().min(1)
const WorkReportArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), issue: textField }).strict(),
  z
    .object({
      action: z.literal('report'),
      token: tokenField,
      kind: z.enum(REPORT_KINDS),
      text: textField,
      stage: z.number().int().positive().optional(),
      step: z.number().int().positive().optional(),
      chosen: z.string().optional(),
      by: z.string().optional(),
      why: z.string().optional(),
      asked: z.string().optional(),
      answer: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('gate'),
      token: tokenField,
      stage: z.number().int().positive(),
      step: z.number().int().positive(),
      self_check: z.array(z.object({ rule: z.string().min(1), accepted: z.boolean(), evidence: textField }).strict()),
      text: textField,
    })
    .strict(),
  z.object({ action: z.literal('deliver'), token: tokenField, pr: textField }).strict(),
  z
    .object({ action: z.literal('post_mortem'), token: tokenField, keep: textField, change: textField, experiment_reflections: textField, free_text: z.string() })
    .strict(),
])

const RetroArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), objective: z.string().min(1), measures: z.array(z.string()).min(1) }).strict(),
  z.object({ action: z.literal('run') }).strict(),
  z.object({ action: z.literal('apply'), proposal: z.number().int().positive() }).strict(),
])

const WorkStatusArgs = z
  .object({
    token: tokenField,
    last: z.number().int().positive().max(MAX_LAST_REPORTS).optional(),
    stage: z.number().int().positive().optional(),
    step: z.number().int().positive().optional(),
  })
  .strict()

export const TOOLS: ToolDefinition[] = [
  {
    name: 'workflow_get',
    description:
      "Describes the workflow, which is the same for everyone in the project. With no arguments: Owner's objective and measures, the work stages, and the running workflow experiments. With `stage`: that work stage's work steps, each with its work gate, the full text of the work policy rules it references, and what Agent must report. With `full`: the whole workflow. With `version`: an earlier workflow version.",
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'integer', minimum: 1, description: 'The work stage number.' },
        full: { type: 'boolean', description: 'Return the whole workflow.' },
        version: { type: 'integer', minimum: 0, description: 'An earlier workflow version; 0 is the first.' },
      },
    },
  },
  {
    name: 'work_report',
    description: [
      'The only way Agent reports to Drillmaster. The action decides the fields.',
      '- start {issue}: starts a work item. Returns its id, your token for every later call, and the first work stage and work step (null while the workflow has no work stages).',
      '- report {token, kind, text}: report in real time. kind: impediment | better_way | decision (+ chosen, by, why) | question (+ asked, answer) | assumption | required | added_step (+ why). stage/step default to where the work item is.',
      "  added_step is the only report after delivery: a fix Owner asked for and chose to have done right away. text: what you did; why: Owner's correction.",
      '- gate {token, stage, step, self_check, text}: hand in a work gate. self_check holds exactly one {rule, accepted, evidence} per rule the gate references; text is what the work step requires reporting. Returns the verdict and where to go next.',
      '- deliver {token, pr}: once every work gate has passed (or the workflow has none).',
      '- post_mortem {token, keep, change, experiment_reflections, free_text}: your workflow post mortem, after delivery.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'report', 'gate', 'deliver', 'post_mortem'] },
        token: { type: 'string', description: 'Your token from start. Every action but start needs it.' },
        issue: { type: 'string', description: 'start: the issue the work item delivers, e.g. "#12".' },
        kind: { type: 'string', enum: [...REPORT_KINDS] },
        text: { type: 'string' },
        stage: { type: 'integer', minimum: 1 },
        step: { type: 'integer', minimum: 1 },
        chosen: { type: 'string' },
        by: { type: 'string' },
        why: { type: 'string' },
        asked: { type: 'string' },
        answer: { type: 'string' },
        self_check: {
          type: 'array',
          items: {
            type: 'object',
            properties: { rule: { type: 'string' }, accepted: { type: 'boolean' }, evidence: { type: 'string' } },
            required: ['rule', 'accepted', 'evidence'],
          },
        },
        pr: { type: 'string' },
        keep: { type: 'string' },
        change: { type: 'string' },
        experiment_reflections: { type: 'string' },
        free_text: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'workflow_retrospective',
    description: [
      'The only place the workflow changes. Owner calls for it, and Drillmaster carries it out.',
      `- setup {objective, measures}: once per project, when Owner sets the objective. Creates workflow_0, which holds only the objective. measures: ${MEASURE_NAMES.join(', ')}.`,
      "- run: Drillmaster's findings (should, did, why, keep, improve) and numbered proposals, from the post mortems, work reports, Owner's corrections and the measures since the last retrospective. Show them to Owner as they are.",
      "- apply {proposal}: applies one proposal Owner approved in their own words. Refused otherwise. Makes the next workflow version, and opens a workflow experiment with its measure's baseline.",
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['setup', 'run', 'apply'] },
        objective: { type: 'string', description: 'setup: what Owner wants Drillmaster to achieve with the workflow.' },
        measures: { type: 'array', items: { type: 'string', enum: [...MEASURE_NAMES] }, description: 'setup: the measures of the objective.' },
        proposal: { type: 'integer', minimum: 1, description: 'apply: the proposal number from the latest run.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'work_status',
    description:
      'Where a work item is: its work stage, work step and pending work gate. With `last`: also the last n work reports. With `stage` and `step`: also the work reports and work traces captured at that work step.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: "Agent's token from work_report start." },
        last: { type: 'integer', minimum: 1, maximum: MAX_LAST_REPORTS },
        stage: { type: 'integer', minimum: 1 },
        step: { type: 'integer', minimum: 1 },
      },
      required: ['token'],
    },
  },
]

export class Drillmaster {
  private readonly lockByProject = new Map<string, Promise<unknown>>()
  private readonly backgroundWork = new Set<Promise<unknown>>()

  constructor(
    private readonly ports: Ports,
    private readonly options: DrillmasterOptions = {},
  ) {}

  private withProjectLock<T>(projectDir: string, criticalSection: (projectId: string) => Promise<T>): Promise<T> {
    const projectId = projectIdOf(projectDir)
    const previousRun = this.lockByProject.get(projectId) ?? Promise.resolve()
    const thisRun = previousRun.then(() => criticalSection(projectId))
    this.lockByProject.set(projectId, thisRun.catch(() => {}))
    return thisRun
  }

  private async appendEvent(projectId: string, newEvent: NewEvent): Promise<DrillmasterEvent> {
    const storedEvent = { ...newEvent, id: this.ports.ids.next('ev'), at: this.ports.clock.now() } as DrillmasterEvent
    await this.ports.store.append(projectId, storedEvent)
    return storedEvent
  }

  private runInBackground(task: Promise<unknown>) {
    const tracked = task.catch((error: unknown) => console.error('Drillmaster background work failed:', error))
    this.backgroundWork.add(tracked)
    void tracked.finally(() => this.backgroundWork.delete(tracked))
  }

  async idle() {
    while (this.backgroundWork.size > 0) await Promise.all([...this.backgroundWork])
  }

  async events(projectDir: string) {
    return this.ports.store.read(projectIdOf(projectDir))
  }

  async state(projectDir: string): Promise<ProjectState> {
    return foldState(await this.events(projectDir))
  }

  async listProjects() {
    const projectIds = await this.ports.store.projectIds()
    const summaries = await Promise.all(projectIds.map(async (projectId) => views.summarizeProject(projectId, await this.ports.store.read(projectId))))
    return summaries.filter((summary) => summary !== undefined).sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''))
  }

  async projectView(projectId: string) {
    const view = views.projectView(projectId, await this.ports.store.read(projectId))
    if (!view) throw new UserError(`No project ${projectId}`, 404)
    return view
  }

  async workItemView(projectId: string, workItemId: string) {
    const view = views.workItemView(await this.ports.store.read(projectId), workItemId)
    if (!view) throw new UserError(`No work item ${workItemId} in project ${projectId}`, 404)
    return view
  }

  init(projectDir: string, objective: unknown) {
    return this.withProjectLock(projectDir, async (projectId) => {
      const parsedObjective = Objective.safeParse(objective)
      if (!parsedObjective.success) throw new UserError(`Invalid objective: ${z.prettifyError(parsedObjective.error)}`)
      const state = foldState(await this.ports.store.read(projectId))
      if (state.initialized) {
        throw new UserError('This project already has a workflow. It changes only at a workflow retrospective.', 409)
      }
      const workflow = workflowZero(parsedObjective.data)
      await this.appendEvent(projectId, { type: 'project_initialized', dir: path.resolve(projectDir), workflow })
      return workflow
    })
  }

  hook(projectDir: string, hookEvent: string, payload: unknown) {
    if (!(HOOK_EVENTS as readonly string[]).includes(hookEvent)) throw new UserError(`Unknown hook event: ${hookEvent}`, 404)
    if (typeof payload !== 'object' || payload === null) throw new UserError('The hook payload must be a JSON object')
    return this.withProjectLock(projectDir, async (projectId) => {
      const state = foldState(await this.ports.store.read(projectId))
      const outcome = handleHook(state, hookEvent, payload as HookPayload, this.options.recordRawHookPayloads ?? false)
      for (const event of outcome.events) await this.appendEvent(projectId, event)
      return { stored: outcome.events.length, output: outcome.output }
    })
  }

  tools() {
    return TOOLS
  }

  async callTool(projectDir: string, toolName: string, toolArgs: unknown): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'workflow_get':
          return toolResult(await this.describeWorkflow(projectDir, parseToolArgs(WorkflowGetArgs, toolArgs)))
        case 'work_report': {
          const { answer, gateSubmissionToJudge } = await this.handleWorkReport(projectDir, parseToolArgs(WorkReportArgs, toolArgs))
          // A Drillmaster gate is judged outside the project lock, so hooks keep flowing meanwhile.
          return toolResult(gateSubmissionToJudge ? await this.judgeDrillmasterGate(projectDir, gateSubmissionToJudge) : answer)
        }
        case 'work_status':
          return toolResult(await this.buildWorkStatus(projectDir, parseToolArgs(WorkStatusArgs, toolArgs)))
        case 'workflow_retrospective': {
          const retroArgs = parseToolArgs(RetroArgs, toolArgs)
          if (retroArgs.action === 'setup') {
            const workflow = await this.init(projectDir, { text: retroArgs.objective, measures: retroArgs.measures })
            return toolResult({ workflow, note: 'workflow_0 holds only the objective. Agent does its best, Owner corrects, and the workflow grows from those corrections.' })
          }
          return toolResult(retroArgs.action === 'run' ? await this.runRetrospective(projectDir) : await this.applyApprovedProposal(projectDir, retroArgs.proposal))
        }
        default:
          throw new UserError(`Unknown tool: ${toolName}`, 404)
      }
    } catch (error) {
      const isCallersMistake =
        error instanceof UserError ||
        error instanceof WorkflowQueryError ||
        error instanceof work.Refused ||
        error instanceof InvalidChange ||
        error instanceof InvalidAnswer
      if (isCallersMistake) return { content: [{ type: 'text', text: error.message }], isError: true }
      throw error
    }
  }

  private async describeWorkflow(projectDir: string, query: z.infer<typeof WorkflowGetArgs>) {
    const events = await this.events(projectDir)
    const view = viewWorkflow(foldState(events), query)
    if (view.kind !== 'overview') return view
    const deliveredItems = measureDeliveredItems(events)
    const measures = Object.fromEntries(
      view.objective.measures.map((measure) => [
        measure,
        { last_5: averageMeasure(deliveredItems.slice(-BASELINE_WINDOW), measure), all: averageMeasure(deliveredItems, measure), delivered: deliveredItems.length },
      ]),
    )
    return { ...view, measures }
  }

  private handleWorkReport(projectDir: string, args: z.infer<typeof WorkReportArgs>): Promise<{ answer: unknown; gateSubmissionToJudge?: string }> {
    return this.withProjectLock(projectDir, async (projectId) => {
      const state = foldState(await this.ports.store.read(projectId))
      const workflow = state.workflow
      if (!workflow) throw new UserError(NO_WORKFLOW_YET)
      if (args.action === 'start') {
        const agentToken = this.ports.ids.secret()
        const firstStage = workflow.stages[0]
        const position = firstStage && firstStage.steps.length > 0 ? { stage: firstStage.n, step: 1 } : { stage: null, step: null }
        const workItemId = this.ports.ids.next('wi')
        await this.appendEvent(projectId, {
          type: 'work_item_started',
          work_item_id: workItemId,
          issue: args.issue,
          workflow_version: workflow.version,
          token_hash: hashToken(agentToken),
          ...position,
        })
        const note =
          position.stage === null
            ? 'The workflow has no work stages yet: do your best, and Owner will correct you.'
            : `Read work stage ${position.stage} with workflow_get before you begin.`
        return { answer: { work_item_id: workItemId, agent_token: agentToken, ...position, note } }
      }
      const item = findWorkItemByTokenHash(state, hashToken(args.token))
      if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
      const { token: _token, action: _action, ...actionArgs } = args
      const decision =
        args.action === 'report'
          ? work.recordReport(item, actionArgs as work.ReportArgs)
          : args.action === 'gate'
            ? work.handInGate(state, item, actionArgs as work.GateArgs)
            : args.action === 'deliver'
              ? work.deliverWorkItem(item, actionArgs as work.DeliverArgs)
              : work.recordPostMortem(item, actionArgs as work.PostMortemArgs)
      let gateSubmissionToJudge: string | undefined
      for (const newEvent of decision.events) {
        const storedEvent = await this.appendEvent(projectId, newEvent)
        if (storedEvent.type === 'gate_submitted' && storedEvent.gate === 'drillmaster') gateSubmissionToJudge = storedEvent.id
        if (storedEvent.type === 'work_item_delivered') this.runInBackground(this.writeDrillmasterPostMortem(projectDir, storedEvent.work_item_id))
      }
      return { answer: decision.answer, gateSubmissionToJudge }
    })
  }

  private async writeDrillmasterPostMortem(projectDir: string, workItemId: string) {
    const events = await this.events(projectDir)
    const item = foldState(events).workItems[workItemId]!
    let postMortem: ReturnType<typeof readPostMortemAnswer>
    try {
      const { answer } = await this.ports.reviewer.review({
        kind: POST_MORTEM_REVIEW_KIND,
        prompt: buildPostMortemPrompt(item, events),
        minTimeoutMs: POST_MORTEM_TIMEOUT_MS,
      })
      postMortem = readPostMortemAnswer(answer)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      postMortem = { keep: '', change: '', experiment_reflections: '', free_text: `Drillmaster could not write its post mortem: ${reason}` }
    }
    await this.withProjectLock(projectDir, async (projectId) => {
      const currentItem = foldState(await this.ports.store.read(projectId)).workItems[workItemId]
      if (currentItem?.post_mortems.includes('drillmaster')) return
      await this.appendEvent(projectId, { type: 'post_mortem_written', work_item_id: workItemId, author: 'drillmaster', ...postMortem })
    })
  }

  private async runRetrospective(projectDir: string) {
    // Drillmaster's own post mortems are written in the background; the retrospective needs them.
    await this.idle()
    const events = await this.events(projectDir)
    const state = foldState(events)
    if (!state.workflow) throw new UserError(NO_WORKFLOW_YET)
    const reviewedItems = deliveredSinceLastRetro(state, events)
    const { answer } = await this.ports.reviewer
      .review({ kind: RETRO_REVIEW_KIND, prompt: buildRetroPrompt(state, events), minTimeoutMs: RETROSPECTIVE_TIMEOUT_MS })
      .catch((error: unknown) => {
        throw new UserError(`Drillmaster could not carry out the retrospective: ${error instanceof Error ? error.message : String(error)}`)
      })
    const retroResult = readRetroAnswer(state.workflow, answer)
    return this.withProjectLock(projectDir, async (projectId) => {
      const storedEvent = await this.appendEvent(projectId, {
        type: 'retrospective_ran',
        retro_id: this.ports.ids.next('retro'),
        work_items: reviewedItems.map((item) => item.work_item_id),
        findings: retroResult.findings,
        proposals: retroResult.proposals,
      })
      return {
        ...toRetroView(storedEvent as Extract<DrillmasterEvent, { type: 'retrospective_ran' }>, retroResult.dropped),
        note: retroResult.proposals.length
          ? "Show Owner the findings and every proposal as they are, numbered. Only Owner's own words approve a proposal; then apply each approved one."
          : 'No workflow changes proposed. Show Owner the findings.',
      }
    })
  }

  private applyApprovedProposal(projectDir: string, proposalId: number) {
    return this.withProjectLock(projectDir, async (projectId) => {
      const events = await this.ports.store.read(projectId)
      const state = foldState(events)
      const retro = state.latestRetroId ? state.retros[state.latestRetroId] : undefined
      if (!retro) throw new UserError('There is no workflow retrospective yet. Run one first.')
      const proposal = retro.proposals.find((candidate) => candidate.id === proposalId)
      if (!proposal) throw new UserError(`The latest retrospective has no proposal ${proposalId}.`)
      if (retro.applied.includes(proposalId)) throw new UserError(`Proposal ${proposalId} is already applied.`)
      if (!retro.approved.includes(proposalId)) {
        throw new UserError(
          retro.declined.includes(proposalId)
            ? `Owner declined proposal ${proposalId}.`
            : `Owner has not approved proposal ${proposalId}. Only Owner's own words approve it: ask Owner.`,
          403,
        )
      }
      const unappliedDependencies = (proposal.depends_on ?? []).filter((dependencyId) => !retro.applied.includes(dependencyId))
      if (unappliedDependencies.length) {
        const several = unappliedDependencies.length > 1
        throw new UserError(
          `Proposal ${proposalId} builds on proposal ${unappliedDependencies.join(', ')}, which is not applied. Apply ${several ? 'those' : 'it'} first, if Owner approved ${several ? 'them' : 'it'}.`,
          409,
        )
      }
      const nextWorkflow = applyProposal(state.workflow!, proposal, measureDeliveredItems(events), this.ports.clock.now().slice(0, 10))
      await this.appendEvent(projectId, { type: 'workflow_changed', workflow: nextWorkflow, reason: proposal.change, retro_id: retro.retro_id, proposal: proposalId })
      const openedExperiment = nextWorkflow.experiments.find((experiment) => !state.workflow!.experiments.some((earlier) => earlier.id === experiment.id))
      return { workflow_version: nextWorkflow.version, change: proposal.change, experiment: openedExperiment ?? null }
    })
  }

  private async judgeDrillmasterGate(projectDir: string, submissionId: string) {
    const events = await this.events(projectDir)
    const submission = events.find((event): event is GateSubmitted => event.type === 'gate_submitted' && event.id === submissionId)!
    const state = foldState(events)
    const item = state.workItems[submission.work_item_id]!
    const workflow = work.workflowOfWorkItem(state, item)

    let judgement: ReturnType<typeof readGateAnswer> | { error: string }
    try {
      const { answer } = await this.ports.reviewer.review({ kind: GATE_REVIEW_KIND, prompt: buildGatePrompt(workflow, item, submission, events) })
      judgement = readGateAnswer(workflow, submission, answer)
    } catch (error) {
      judgement = { error: error instanceof Error ? error.message : String(error) }
    }

    return this.withProjectLock(projectDir, async (projectId) => {
      const currentItem = foldState(await this.ports.store.read(projectId)).workItems[item.work_item_id]
      const stillPending =
        currentItem?.pending_gate?.gate === 'drillmaster' && currentItem.pending_gate.stage === submission.stage && currentItem.pending_gate.step === submission.step
      if (!stillPending) return { verdict: 'superseded', note: 'This gate was decided while Drillmaster was judging it. Check work_status.' }
      const gatePosition = { work_item_id: item.work_item_id, stage: submission.stage, step: submission.step }
      if ('error' in judgement) {
        await this.appendEvent(projectId, { type: 'review_failed', ...gatePosition, error: judgement.error })
        return {
          verdict: 'pending',
          gate: 'drillmaster',
          ...gatePosition,
          note: `Drillmaster could not judge this gate (${judgement.error}). Hand the gate in again, or report the impediment.`,
        }
      }
      await this.appendEvent(projectId, { type: 'gate_verdict', ...gatePosition, by: 'drillmaster', ...judgement })
      return {
        verdict: judgement.accepted ? 'accepted' : 'rejected',
        by: 'drillmaster',
        rule: judgement.rule,
        why: judgement.why,
        next: judgement.next,
        done: judgement.done,
        note: judgement.accepted
          ? judgement.done
            ? 'Every work gate has passed. Deliver the work item.'
            : `Next: work step ${judgement.next.stage}.${judgement.next.step}.`
          : `Go back to work step ${judgement.next.stage}.${judgement.next.step}. A rejection is an impediment: report what got in the way.`,
      }
    })
  }

  private async buildWorkStatus(projectDir: string, args: z.infer<typeof WorkStatusArgs>) {
    const events = await this.events(projectDir)
    const state = foldState(events)
    const item = findWorkItemByTokenHash(state, hashToken(args.token))
    if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
    const status: Record<string, unknown> = {
      work_item_id: item.work_item_id,
      issue: item.issue,
      workflow_version: item.workflow_version,
      status: item.status,
      stage: item.stage,
      step: item.step,
      pending_gate: item.pending_gate,
      gates_done: item.gates_done,
      pr: item.pr,
      sessions: item.sessions,
      traces: item.traces,
      reports: item.reports,
      rejections: item.rejections,
      post_mortems: item.post_mortems,
    }
    const verdicts = events.filter((event) => event.type === 'gate_verdict' && event.work_item_id === item.work_item_id)
    status.last_verdict = verdicts.at(-1) ?? null
    if (args.last !== undefined) status.last_reports = workReportsOf(events, item.work_item_id).slice(-args.last)
    if (args.stage !== undefined || args.step !== undefined) {
      const atStep = { stage: args.stage, step: args.step }
      status.captured = {
        reports: workReportsOf(events, item.work_item_id, atStep),
        traces: workTracesOf(events, item.work_item_id, atStep).map(({ raw: _raw, ...trace }) => trace),
      }
    }
    return status
  }
}

function parseToolArgs<T>(schema: z.ZodType<T>, toolArgs: unknown): T {
  const parsed = schema.safeParse(toolArgs ?? {})
  if (!parsed.success) throw new UserError(z.prettifyError(parsed.error))
  return parsed.data
}

const toolResult = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
