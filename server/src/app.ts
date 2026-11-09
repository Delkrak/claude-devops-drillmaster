// The Drillmaster application: everything the server can do, independent of HTTP or MCP. The
// daemon exposes it over REST, and the stdio shim forwards MCP tool calls to it.

import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { REPORT_KINDS, type DrillmasterEvent, type GateSubmitted, type NewEvent } from './core/events.js'
import { average, MEASURE_NAMES, measureItems } from './core/measures.js'
import {
  applyProposal,
  buildPostMortemPrompt,
  buildRetroPrompt,
  InvalidChange,
  POST_MORTEM_REVIEW,
  readPostMortemAnswer,
  readRetroAnswer,
  RETRO_REVIEW,
  retroView,
  sinceLastRetro,
} from './core/retro.js'
import { buildGatePrompt, GATE_REVIEW, InvalidAnswer, readGateAnswer } from './core/review.js'
import { handleHook, HOOK_EVENTS, type HookPayload } from './core/hooks.js'
import { foldState, itemByTokenHash, reportsOf, tracesOf, viewWorkflow, WorkflowQueryError, type ProjectState } from './core/state.js'
import * as views from './core/views.js'
import * as work from './core/work.js'
import { Objective, workflowZero } from './core/workflow.js'
import { projectId } from './env.js'
import type { Ports } from './ports.js'

/** A request the caller got wrong: shown to the caller, never a server fault. */
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
  /** Keep raw hook payloads in the work traces, to turn sessions into test fixtures. */
  record?: boolean
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const WorkflowGetArgs = z
  .object({
    stage: z.number().int().positive().optional(),
    full: z.boolean().optional(),
    version: z.number().int().nonnegative().optional(),
  })
  .strict()

const token = z.string().min(1)
const text = z.string().min(1)
const WorkReportArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), issue: text }).strict(),
  z
    .object({
      action: z.literal('report'),
      token,
      kind: z.enum(REPORT_KINDS),
      text,
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
      token,
      stage: z.number().int().positive(),
      step: z.number().int().positive(),
      self_check: z.array(z.object({ rule: z.string().min(1), accepted: z.boolean(), evidence: text }).strict()),
      text,
    })
    .strict(),
  z.object({ action: z.literal('deliver'), token, pr: text }).strict(),
  z
    .object({ action: z.literal('post_mortem'), token, keep: text, change: text, experiment_reflections: text, free_text: z.string() })
    .strict(),
])

const RetroArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), objective: z.string().min(1), measures: z.array(z.string()).min(1) }).strict(),
  z.object({ action: z.literal('run') }).strict(),
  z.object({ action: z.literal('apply'), proposal: z.number().int().positive() }).strict(),
])

const WorkStatusArgs = z
  .object({
    token: z.string().min(1),
    last: z.number().int().positive().max(200).optional(),
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
        token: { type: 'string', description: "Your token from start. Every action but start needs it." },
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
        objective: { type: 'string', description: "setup: what Owner wants Drillmaster to achieve with the workflow." },
        measures: { type: 'array', items: { type: 'string', enum: [...MEASURE_NAMES] }, description: 'setup: the measures of the objective.' },
        proposal: { type: 'integer', minimum: 1, description: "apply: the proposal number from the latest run." },
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
        last: { type: 'integer', minimum: 1, maximum: 200 },
        stage: { type: 'integer', minimum: 1 },
        step: { type: 'integer', minimum: 1 },
      },
      required: ['token'],
    },
  },
]

export class Drillmaster {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly ports: Ports,
    private readonly options: DrillmasterOptions = {},
  ) {}

  /** Runs read-fold-append for one project at a time, so concurrent hooks never race. */
  private exclusive<T>(dir: string, fn: (project: string) => Promise<T>): Promise<T> {
    const project = projectId(dir)
    const previous = this.locks.get(project) ?? Promise.resolve()
    const next = previous.then(() => fn(project))
    this.locks.set(project, next.catch(() => {}))
    return next
  }

  private async append(project: string, event: NewEvent): Promise<DrillmasterEvent> {
    const full = { ...event, id: this.ports.ids.next('ev'), at: this.ports.clock.now() } as DrillmasterEvent
    await this.ports.store.append(project, full)
    return full
  }

  async events(dir: string) {
    return this.ports.store.read(projectId(dir))
  }

  // ------------------------------------------------------------ read-only views for the viewer

  async listProjects() {
    const ids = await this.ports.store.projects()
    const summaries = await Promise.all(ids.map(async (id) => views.summarizeProject(id, await this.ports.store.read(id))))
    return summaries.filter((s) => s !== undefined).sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''))
  }

  async projectView(id: string) {
    const view = views.projectView(id, await this.ports.store.read(id))
    if (!view) throw new UserError(`No project ${id}`, 404)
    return view
  }

  async workItemView(id: string, workItemId: string) {
    const view = views.workItemView(await this.ports.store.read(id), workItemId)
    if (!view) throw new UserError(`No work item ${workItemId} in project ${id}`, 404)
    return view
  }

  async state(dir: string): Promise<ProjectState> {
    return foldState(await this.events(dir))
  }

  /** Creates workflow_0 from Owner's objective. A project is initialized once. */
  init(dir: string, objective: unknown) {
    return this.exclusive(dir, async (project) => {
      const parsed = Objective.safeParse(objective)
      if (!parsed.success) throw new UserError(`Invalid objective: ${z.prettifyError(parsed.error)}`)
      const state = foldState(await this.ports.store.read(project))
      if (state.initialized) {
        throw new UserError('This project already has a workflow. It changes only at a workflow retrospective.', 409)
      }
      const workflow = workflowZero(parsed.data)
      await this.append(project, { type: 'project_initialized', dir: path.resolve(dir), workflow })
      return workflow
    })
  }

  /** Stores what a Claude Code hook saw, and returns what the hook should print. */
  hook(dir: string, event: string, payload: unknown) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) throw new UserError(`Unknown hook event: ${event}`, 404)
    if (typeof payload !== 'object' || payload === null) throw new UserError('The hook payload must be a JSON object')
    return this.exclusive(dir, async (project) => {
      const state = foldState(await this.ports.store.read(project))
      const outcome = handleHook(state, event, payload as HookPayload, this.options.record ?? false)
      for (const e of outcome.events) await this.append(project, e)
      return { stored: outcome.events.length, output: outcome.output }
    })
  }

  tools() {
    return TOOLS
  }

  async callTool(dir: string, name: string, args: unknown): Promise<ToolResult> {
    try {
      switch (name) {
        case 'workflow_get': {
          const parsed = parse(WorkflowGetArgs, args)
          const events = await this.events(dir)
          const view = viewWorkflow(foldState(events), parsed)
          if (view.kind !== 'overview') return ok(view)
          // The objective's measures as they stand: over the last few and all delivered work items.
          const items = measureItems(events)
          const measures = Object.fromEntries(
            view.objective.measures.map((m) => [m, { last_5: average(items.slice(-5), m), all: average(items, m), delivered: items.length }]),
          )
          return ok({ ...view, measures })
        }
        case 'work_report': {
          const { answer, review } = await this.workReport(dir, parse(WorkReportArgs, args))
          // A Drillmaster gate is judged outside the project lock, so hooks keep flowing meanwhile.
          return ok(review ? await this.reviewGate(dir, review) : answer)
        }
        case 'work_status':
          return ok(await this.workStatus(dir, parse(WorkStatusArgs, args)))
        case 'workflow_retrospective': {
          const a = parse(RetroArgs, args)
          if (a.action === 'setup') {
            const workflow = await this.init(dir, { text: a.objective, measures: a.measures })
            return ok({ workflow, note: 'workflow_0 holds only the objective. Agent does its best, Owner corrects, and the workflow grows from those corrections.' })
          }
          return ok(a.action === 'run' ? await this.runRetro(dir) : await this.applyProposal(dir, a.proposal))
        }
        default:
          throw new UserError(`Unknown tool: ${name}`, 404)
      }
    } catch (error) {
      if (
        error instanceof UserError ||
        error instanceof WorkflowQueryError ||
        error instanceof work.Refused ||
        error instanceof InvalidChange ||
        error instanceof InvalidAnswer
      ) {
        return { content: [{ type: 'text', text: error.message }], isError: true }
      }
      throw error
    }
  }

  private workReport(dir: string, args: z.infer<typeof WorkReportArgs>): Promise<{ answer: unknown; review?: string }> {
    return this.exclusive(dir, async (project) => {
      const state = foldState(await this.ports.store.read(project))
      const workflow = state.workflow
      if (!workflow) throw new UserError('This project has no workflow yet. Owner sets the objective first (setup).')
      switch (args.action) {
        case 'start': {
          const token = this.ports.ids.secret()
          const first = workflow.stages[0]
          const position = first && first.steps.length > 0 ? { stage: first.n, step: 1 } : { stage: null, step: null }
          const workItemId = this.ports.ids.next('wi')
          await this.append(project, {
            type: 'work_item_started',
            work_item_id: workItemId,
            issue: args.issue,
            workflow_version: workflow.version,
            token_hash: hashToken(token),
            ...position,
          })
          return {
            answer: {
              work_item_id: workItemId,
              agent_token: token,
              ...position,
              note:
                position.stage === null
                  ? 'The workflow has no work stages yet: do your best, and Owner will correct you.'
                  : `Read work stage ${position.stage} with workflow_get before you begin.`,
            },
          }
        }
        default: {
          const item = itemByTokenHash(state, hashToken(args.token))
          if (!item) throw new UserError('Unknown token. Use the agent_token that work_report start returned.', 403)
          const { token: _token, action: _action, ...rest } = args
          const decision =
            args.action === 'report'
              ? work.report(item, rest as work.ReportArgs)
              : args.action === 'gate'
                ? work.gate(state, item, rest as work.GateArgs)
                : args.action === 'deliver'
                  ? work.deliver(item, rest as work.DeliverArgs)
                  : work.postMortem(item, rest as work.PostMortemArgs)
          let review: string | undefined
          for (const event of decision.events) {
            const stored = await this.append(project, event)
            if (stored.type === 'gate_submitted' && stored.gate === 'drillmaster') review = stored.id
            if (stored.type === 'work_item_delivered') this.background(this.drillmasterPostMortem(dir, stored.work_item_id))
          }
          return { answer: decision.answer, review }
        }
      }
    })
  }

  private readonly running = new Set<Promise<unknown>>()

  /** Work that outlives its request, such as Drillmaster's post mortem. */
  private background(work: Promise<unknown>) {
    const tracked = work.catch((error: unknown) => console.error('Drillmaster background work failed:', error))
    this.running.add(tracked)
    void tracked.finally(() => this.running.delete(tracked))
  }

  /** Resolves when all background work is done. For tests and clean shutdowns. */
  async idle() {
    while (this.running.size > 0) await Promise.all([...this.running])
  }

  /** Drillmaster writes its own workflow post mortem once a work item is delivered. */
  private async drillmasterPostMortem(dir: string, workItemId: string) {
    const events = await this.events(dir)
    const item = foldState(events).workItems[workItemId]!
    let written: ReturnType<typeof readPostMortemAnswer>
    try {
      const { answer } = await this.ports.reviewer.review({ kind: POST_MORTEM_REVIEW, prompt: buildPostMortemPrompt(item, events), timeoutMs: 180_000 })
      written = readPostMortemAnswer(answer)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      written = { keep: '', change: '', experiment_reflections: '', free_text: `Drillmaster could not write its post mortem: ${reason}` }
    }
    await this.exclusive(dir, async (project) => {
      const now = foldState(await this.ports.store.read(project)).workItems[workItemId]
      if (now?.post_mortems.includes('drillmaster')) return
      await this.append(project, { type: 'post_mortem_written', work_item_id: workItemId, author: 'drillmaster', ...written })
    })
  }

  /** Drillmaster carries out the workflow retrospective Owner called for. */
  private async runRetro(dir: string) {
    await this.idle() // Every post mortem in first.
    const events = await this.events(dir)
    const state = foldState(events)
    if (!state.workflow) throw new UserError('This project has no workflow yet. Owner sets the objective first (setup).')
    const items = sinceLastRetro(state, events)
    const { answer } = await this.ports.reviewer
      .review({ kind: RETRO_REVIEW, prompt: buildRetroPrompt(state, events), timeoutMs: 300_000 })
      .catch((error: unknown) => {
        throw new UserError(`Drillmaster could not carry out the retrospective: ${error instanceof Error ? error.message : String(error)}`)
      })
    const read = readRetroAnswer(state.workflow, answer)
    return this.exclusive(dir, async (project) => {
      const stored = await this.append(project, {
        type: 'retrospective_ran',
        retro_id: this.ports.ids.next('retro'),
        work_items: items.map((i) => i.work_item_id),
        findings: read.findings,
        proposals: read.proposals,
      })
      return {
        ...retroView(stored as Extract<DrillmasterEvent, { type: 'retrospective_ran' }>, read.dropped),
        note: read.proposals.length
          ? 'Show Owner the findings and every proposal as they are, numbered. Only Owner\'s own words approve a proposal; then apply each approved one.'
          : 'No workflow changes proposed. Show Owner the findings.',
      }
    })
  }

  /** Applies one proposal of the latest retrospective, only if Owner approved it. */
  private applyProposal(dir: string, id: number) {
    return this.exclusive(dir, async (project) => {
      const events = await this.ports.store.read(project)
      const state = foldState(events)
      const retro = state.latestRetro ? state.retros[state.latestRetro] : undefined
      if (!retro) throw new UserError('There is no workflow retrospective yet. Run one first.')
      const proposal = retro.proposals.find((p) => p.id === id)
      if (!proposal) throw new UserError(`The latest retrospective has no proposal ${id}.`)
      if (retro.applied.includes(id)) throw new UserError(`Proposal ${id} is already applied.`)
      if (!retro.approved.includes(id)) {
        throw new UserError(
          retro.declined.includes(id)
            ? `Owner declined proposal ${id}.`
            : `Owner has not approved proposal ${id}. Only Owner's own words approve it: ask Owner.`,
          403,
        )
      }
      const missing = (proposal.depends_on ?? []).filter((d) => !retro.applied.includes(d))
      if (missing.length) {
        throw new UserError(`Proposal ${id} builds on proposal ${missing.join(', ')}, which is not applied. Apply ${missing.length > 1 ? 'those' : 'it'} first, if Owner approved ${missing.length > 1 ? 'them' : 'it'}.`, 409)
      }
      const next = applyProposal(state.workflow!, proposal, measureItems(events), this.ports.clock.now().slice(0, 10))
      await this.append(project, { type: 'workflow_changed', workflow: next, reason: proposal.change, retro_id: retro.retro_id, proposal: id })
      const opened = next.experiments.find((x) => !state.workflow!.experiments.some((old) => old.id === x.id))
      return { workflow_version: next.version, change: proposal.change, experiment: opened ?? null }
    })
  }

  /** Asks Drillmaster to judge a submitted gate, then records the verdict, or the failure. */
  private async reviewGate(dir: string, submissionId: string) {
    const events = await this.events(dir)
    const submission = events.find((e): e is GateSubmitted => e.type === 'gate_submitted' && e.id === submissionId)!
    const state = foldState(events)
    const item = state.workItems[submission.work_item_id]!
    const doc = work.workflowOf(state, item)

    let outcome: ReturnType<typeof readGateAnswer> | { error: string }
    try {
      const { answer } = await this.ports.reviewer.review({ kind: GATE_REVIEW, prompt: buildGatePrompt(doc, item, submission, events) })
      outcome = readGateAnswer(doc, submission, answer)
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message : String(error) }
    }

    return this.exclusive(dir, async (project) => {
      const now = foldState(await this.ports.store.read(project)).workItems[item.work_item_id]
      const stillPending = now?.pending_gate?.gate === 'drillmaster' && now.pending_gate.stage === submission.stage && now.pending_gate.step === submission.step
      if (!stillPending) return { verdict: 'superseded', note: 'This gate was decided while Drillmaster was judging it. Check work_status.' }
      const at = { work_item_id: item.work_item_id, stage: submission.stage, step: submission.step }
      if ('error' in outcome) {
        await this.append(project, { type: 'review_failed', ...at, error: outcome.error })
        return {
          verdict: 'pending',
          gate: 'drillmaster',
          ...at,
          note: `Drillmaster could not judge this gate (${outcome.error}). Hand the gate in again, or report the impediment.`,
        }
      }
      await this.append(project, { type: 'gate_verdict', ...at, by: 'drillmaster', ...outcome })
      return {
        verdict: outcome.accepted ? 'accepted' : 'rejected',
        by: 'drillmaster',
        rule: outcome.rule,
        why: outcome.why,
        next: outcome.next,
        done: outcome.done,
        note: outcome.accepted
          ? outcome.done
            ? 'Every work gate has passed. Deliver the work item.'
            : `Next: work step ${outcome.next.stage}.${outcome.next.step}.`
          : `Go back to work step ${outcome.next.stage}.${outcome.next.step}. A rejection is an impediment: report what got in the way.`,
      }
    })
  }

  private async workStatus(dir: string, args: z.infer<typeof WorkStatusArgs>) {
    const events = await this.events(dir)
    const state = foldState(events)
    const item = itemByTokenHash(state, hashToken(args.token))
    if (!item) throw new UserError('Unknown token. Use the agent_token that work_report start returned.', 403)
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
    const verdicts = events.filter((e) => e.type === 'gate_verdict' && e.work_item_id === item.work_item_id)
    status.last_verdict = verdicts.at(-1) ?? null
    if (args.last !== undefined) status.last_reports = reportsOf(events, item.work_item_id).slice(-args.last)
    if (args.stage !== undefined || args.step !== undefined) {
      const at = { stage: args.stage, step: args.step }
      status.captured = {
        reports: reportsOf(events, item.work_item_id, at),
        traces: tracesOf(events, item.work_item_id, at).map(({ raw: _raw, ...trace }) => trace),
      }
    }
    return status
  }
}

function parse<T>(schema: z.ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args ?? {})
  if (!parsed.success) throw new UserError(z.prettifyError(parsed.error))
  return parsed.data
}

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
