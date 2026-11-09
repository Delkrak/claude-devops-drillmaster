import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { InvalidArtifact, readArtifactFromWorkFolder } from './adapters/artifacts.js'
import { REPORT_KINDS, type DrillmasterEvent, type GateSubmitted, type MetricAnswer, type NewEvent } from './core/events.js'
import { judgeExperiments } from './core/experiments.js'
import { handleHook, HOOK_EVENTS, type HookPayload } from './core/hooks.js'
import { averageMeasure, BASELINE_WINDOW, MEASURE_NAMES, measureDeliveredItems } from './core/measures.js'
import {
  applyProposal,
  buildPostMortemPrompt,
  buildRetroPrompt,
  deliveredSinceLastRetro,
  InvalidChange,
  MAX_PROPOSALS,
  POST_MORTEM_REVIEW_KIND,
  readPostMortemAnswer,
  readRetroAnswer,
  retrospectiveDue,
  RETRO_REVIEW_KIND,
  toRetroView,
} from './core/retro.js'
import { buildLateStartPrompt, describeWorkflowChange, LATE_START_REVIEW_KIND, readLateStartAnswer, requestLateStart } from './core/lateStart.js'
import { askUserQuestionInput, pendingOwnerQuestions } from './core/questions.js'
import * as render from './core/render.js'
import {
  buildGatePrompt,
  buildMetricPrompt,
  dueDrillmasterMetrics,
  GATE_REVIEW_KIND,
  InvalidAnswer,
  METRIC_REVIEW_KIND,
  readGateAnswer,
  readMetricAnswers,
} from './core/review.js'
import {
  findVersion,
  findWorkItemByTokenHash,
  firstPosition,
  foldState,
  viewWorkflow,
  WorkflowQueryError,
  workReportsOf,
  workTracesOf,
  type ProjectState,
  type RetroState,
  type WorkItemState,
} from './core/state.js'
import * as views from './core/views.js'
import * as work from './core/work.js'
import { compareVersions, Objective, toSemver, workflowZero, type WorkflowDocument } from './core/workflow.js'
import { projectId as projectIdOf } from './env.js'
import type { Ports } from './ports.js'
import { VERSION } from './version.js'

const POST_MORTEM_TIMEOUT_MS = 180_000
const RETROSPECTIVE_TIMEOUT_MS = 300_000
const MAX_LAST_REPORTS = 200
const MAX_ARTIFACTS = 10
const NO_WORKFLOW_YET = 'This project has no workflow yet. Owner sets the objective first (setup).'
const UNKNOWN_TOKEN = 'Unknown token. Use the agent_token that work_start returned.'

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
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

interface KnownVersions {
  workflow?: string
  items: Map<string, string>
  newestDrillmaster: string
}

export interface DrillmasterOptions {
  recordRawHookPayloads?: boolean
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const WorkflowGetArgs = z
  .object({
    stage: z.number().int().positive().optional(),
    full: z.boolean().optional(),
    version: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  })
  .strict()

const tokenField = z.string().min(1)
const textField = z.string().min(1)
const MetricAnswerArgs = z.object({ name: textField, value: textField, explanation: z.string().optional() }).strict()

const StartAt = z.object({ stage: z.number().int().positive(), step: z.number().int().positive() }).strict()
const WorkStartArgs = z
  .object({ issue: textField, description: textField, start_at: StartAt.optional(), justification: textField.optional(), evidence: textField.optional() })
  .strict()
  .refine((args) => !args.start_at || (args.justification && args.evidence), 'A late start (start_at) needs a justification and evidence.')
const WorkSkipArgs = z.object({ token: tokenField, start_at: StartAt, justification: textField, evidence: textField }).strict()
const WorkReportArgs = z
  .object({
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
  .strict()
const WorkGateArgs = z
  .object({
    token: tokenField,
    stage: z.number().int().positive(),
    step: z.number().int().positive(),
    self_check: z.array(z.object({ rule: z.string().min(1), accepted: z.boolean(), evidence: textField }).strict()),
    text: textField,
    metrics: z.array(MetricAnswerArgs).optional(),
  })
  .strict()
const WorkDeliverArgs = z.object({ token: tokenField, pr: textField, summary: textField, artifacts: z.array(textField).max(MAX_ARTIFACTS).optional() }).strict()
const WorkPostMortemArgs = z.object({ token: tokenField, keep: textField, change: textField, experiment_reflections: textField, free_text: z.string() }).strict()

const RetroArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), objective: z.string().min(1), measures: z.array(z.string()).min(1) }).strict(),
  z.object({ action: z.literal('run') }).strict(),
  z.object({ action: z.literal('apply'), proposal: z.number().int().positive().optional() }).strict(),
])

const WorkStatusArgs = z
  .object({
    token: tokenField,
    last: z.number().int().positive().max(MAX_LAST_REPORTS).optional(),
    stage: z.number().int().positive().optional(),
    step: z.number().int().positive().optional(),
  })
  .strict()

const tokenProperty = { token: { type: 'string', description: 'Your agent_token from work_start.' } }
const lateStartProperties = {
  start_at: {
    type: 'object',
    description: 'A late start: the work step to start at, skipping the ones before it. Needs justification and evidence.',
    properties: { stage: { type: 'integer', minimum: 1 }, step: { type: 'integer', minimum: 1 } },
    required: ['stage', 'step'],
  },
  justification: { type: 'string', description: 'Why the skipped work steps are already done.' },
  evidence: { type: 'string', description: 'What shows it: commits, test output, files, earlier work items.' },
}
const selfCheckProperty = {
  type: 'array',
  description: 'Exactly one entry per rule the gate checks.',
  items: {
    type: 'object',
    properties: { rule: { type: 'string', description: 'The rule reference, e.g. "test 1.1".' }, accepted: { type: 'boolean' }, evidence: { type: 'string' } },
    required: ['rule', 'accepted', 'evidence'],
  },
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'workflow_get',
    description:
      "Describes the workflow, which is the same for everyone in the project. With no arguments: Owner's objective and measures, the work stages with their purpose, the metrics, and the running workflow experiments. With `stage`: that work stage's work steps, each with its instruction, its work gate, the full text of the rules it checks, and what to report. With `full`: the whole workflow. With `version`: an earlier workflow version, e.g. \"1.0.0\".",
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'integer', minimum: 1, description: 'The work stage number.' },
        full: { type: 'boolean', description: 'Return the whole workflow.' },
        version: { type: 'string', description: 'An earlier workflow version (major.minor.patch); 0.0.0 is the first.' },
      },
    },
  },
  {
    name: 'work_start',
    description:
      'Starts a work item. Returns its id, your agent_token for every later work tool, and the first work step in full: what to do, the gate, its rules, and what to report.',
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'The issue the work item delivers, e.g. "#12".' },
        description: { type: 'string', description: 'What the work item is about, in a few sentences: the problem and the expected result.' },
        ...lateStartProperties,
      },
      required: ['issue', 'description'],
    },
  },
  {
    name: 'work_skip',
    description:
      'Asks to skip ahead to a later work step, because earlier work (for example before a restart, or done outside a work item) already meets the skipped steps. Drillmaster judges the skipped self and Drillmaster gates from your evidence and the work traces; Owner decides any skipped Owner gate. Returns the verdict and the step to do.',
    inputSchema: {
      type: 'object',
      properties: { ...tokenProperty, ...lateStartProperties },
      required: ['token', 'start_at', 'justification', 'evidence'],
    },
  },
  {
    name: 'work_report',
    description: [
      'Report to Drillmaster in real time, while you work.',
      'kind: impediment | better_way | decision (+ chosen, by, why) | question (+ asked, answer) | assumption | required | added_step (+ why).',
      'stage/step default to where the work item is.',
      "added_step is the only report after delivery: a fix Owner asked for and chose to have done right away. text: what you did; why: Owner's correction.",
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        kind: { type: 'string', enum: [...REPORT_KINDS] },
        text: { type: 'string' },
        stage: { type: 'integer', minimum: 1 },
        step: { type: 'integer', minimum: 1 },
        chosen: { type: 'string' },
        by: { type: 'string' },
        why: { type: 'string' },
        asked: { type: 'string' },
        answer: { type: 'string' },
      },
      required: ['token', 'kind', 'text'],
    },
  },
  {
    name: 'work_gate',
    description:
      "Hands in the work gate of the current work step, once its work is done. self_check holds exactly one {rule, accepted, evidence} per rule the gate checks; text is what the step requires reporting; metrics answers the metrics that are yours to take at this step. Returns the verdict and the next work step in full.",
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        stage: { type: 'integer', minimum: 1 },
        step: { type: 'integer', minimum: 1 },
        self_check: selfCheckProperty,
        text: { type: 'string' },
        metrics: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, explanation: { type: 'string' } }, required: ['name', 'value'] },
        },
      },
      required: ['token', 'stage', 'step', 'self_check', 'text'],
    },
  },
  {
    name: 'work_deliver',
    description:
      'Delivers the work item, once every work gate has passed (or the workflow has none). summary: what was delivered and how it was verified. artifacts: paths of files in the work folder that show the result, such as screenshots (images or text, at most 5 MB each, not ignored by git).',
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        pr: { type: 'string', description: 'The pull request or branch that holds the work.' },
        summary: { type: 'string' },
        artifacts: { type: 'array', items: { type: 'string' }, maxItems: MAX_ARTIFACTS },
      },
      required: ['token', 'pr', 'summary'],
    },
  },
  {
    name: 'work_post_mortem',
    description: 'Your workflow post mortem, after delivery: what in the workflow helped, what got in the way, how the experiments did, and anything else.',
    inputSchema: {
      type: 'object',
      properties: { ...tokenProperty, keep: { type: 'string' }, change: { type: 'string' }, experiment_reflections: { type: 'string' }, free_text: { type: 'string' } },
      required: ['token', 'keep', 'change', 'experiment_reflections', 'free_text'],
    },
  },
  {
    name: 'workflow_retrospective',
    description: [
      'The only place the workflow changes. Owner calls for it, and Drillmaster carries it out.',
      `- setup {objective, measures}: once per project, when Owner sets the objective. Creates workflow 0.0.0, which holds only the objective. measures: ${MEASURE_NAMES.join(', ')}.`,
      `- run: Drillmaster's findings (should, did, why, keep, improve) and at most ${MAX_PROPOSALS} numbered proposals, from the post mortems, work reports, Owner's corrections, the measures and the experiments' verdicts. Show them to Owner as they are.`,
      "- apply: applies every proposal Owner approved, in order (or only `proposal`). Each makes the next workflow version and opens a workflow experiment with its measure's baseline.",
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['setup', 'run', 'apply'] },
        objective: { type: 'string', description: 'setup: what Owner wants Drillmaster to achieve with the workflow.' },
        measures: { type: 'array', items: { type: 'string', enum: [...MEASURE_NAMES] }, description: 'setup: the measures of the objective.' },
        proposal: { type: 'integer', minimum: 1, description: 'apply: only this proposal from the latest run.' },
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
        ...tokenProperty,
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
  private readonly knownVersionsByProject = new Map<string, KnownVersions>()
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

  /** The versions events of a project are made under, kept as events are appended. */
  private async versionsOf(projectId: string): Promise<KnownVersions> {
    let known = this.knownVersionsByProject.get(projectId)
    if (!known) {
      const events = await this.ports.store.read(projectId)
      const state = foldState(events)
      known = {
        workflow: state.workflow?.version,
        items: new Map(Object.values(state.workItems).map((item) => [item.work_item_id, item.workflow_version])),
        newestDrillmaster: events.reduce((newest, event) => (event.drillmaster_version && compareVersions(event.drillmaster_version, newest) > 0 ? event.drillmaster_version : newest), '0.0.0'),
      }
      this.knownVersionsByProject.set(projectId, known)
    }
    return known
  }

  private async appendEvent(projectId: string, newEvent: NewEvent): Promise<DrillmasterEvent> {
    const known = await this.versionsOf(projectId)
    if (compareVersions(known.newestDrillmaster, VERSION) > 0) {
      throw new UserError(`This project was written by Drillmaster ${known.newestDrillmaster}, which is newer than this one (${VERSION}). Upgrade Drillmaster before you work on it.`, 409)
    }
    const workItemId = 'work_item_id' in newEvent && typeof newEvent.work_item_id === 'string' ? newEvent.work_item_id : undefined
    const madeUnder = (workItemId ? known.items.get(workItemId) : undefined) ?? known.workflow
    const storedEvent = {
      id: this.ports.ids.next('ev'),
      at: this.ports.clock.now(),
      ...(madeUnder ? { workflow_version: madeUnder } : {}),
      drillmaster_version: VERSION,
      ...newEvent,
    } as DrillmasterEvent
    await this.ports.store.append(projectId, storedEvent)
    if (storedEvent.type === 'project_initialized' || storedEvent.type === 'workflow_changed') known.workflow = toSemver(storedEvent.workflow.version)
    if (storedEvent.type === 'work_item_started') known.items.set(storedEvent.work_item_id, toSemver(storedEvent.workflow_version))
    if (storedEvent.type === 'work_item_restarted') known.items.set(storedEvent.work_item_id, storedEvent.to_version)
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
      const events = await this.ports.store.read(projectId)
      const state = foldState(events)
      const context = hookEvent === 'SessionStart' ? { retrospectiveDue: retrospectiveDue(state, events) } : {}
      const outcome = handleHook(state, hookEvent, payload as HookPayload, this.options.recordRawHookPayloads ?? false, context)
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
          return jsonResult(await this.describeWorkflow(projectDir, parseToolArgs(WorkflowGetArgs, toolArgs)))
        case 'work_start':
          return await this.startWorkItem(projectDir, parseToolArgs(WorkStartArgs, toolArgs))
        case 'work_skip':
          return await this.skipToWorkStep(projectDir, parseToolArgs(WorkSkipArgs, toolArgs))
        case 'work_report':
        case 'work_gate':
        case 'work_deliver':
        case 'work_post_mortem':
          return await this.handleWorkTool(projectDir, toolName, toolArgs)
        case 'work_status':
          return jsonResult(await this.buildWorkStatus(projectDir, parseToolArgs(WorkStatusArgs, toolArgs)))
        case 'workflow_retrospective': {
          const retroArgs = parseToolArgs(RetroArgs, toolArgs)
          if (retroArgs.action === 'setup') {
            const workflow = await this.init(projectDir, { text: retroArgs.objective, measures: retroArgs.measures })
            return jsonResult({ workflow, note: 'Workflow 0.0.0 holds only the objective. Agent does its best, Owner corrects, and the workflow grows from those corrections.' })
          }
          return jsonResult(retroArgs.action === 'run' ? await this.runRetrospective(projectDir) : await this.applyApprovedProposals(projectDir, retroArgs.proposal))
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
        error instanceof InvalidAnswer ||
        error instanceof InvalidArtifact
      if (isCallersMistake) return { content: [{ type: 'text', text: error.message }], isError: true }
      throw error
    }
  }

  private async describeWorkflow(projectDir: string, query: z.infer<typeof WorkflowGetArgs>) {
    const events = await this.events(projectDir)
    const state = foldState(events)
    const view = viewWorkflow(state, { ...query, version: query.version === undefined ? undefined : toSemver(query.version) })
    if (view.kind !== 'overview') return view
    const deliveredItems = measureDeliveredItems(events)
    const measures = Object.fromEntries(
      view.objective.measures.map((measure) => [
        measure,
        { last_5: averageMeasure(deliveredItems.slice(-BASELINE_WINDOW), measure), all: averageMeasure(deliveredItems, measure), delivered: deliveredItems.length },
      ]),
    )
    const workflow = findVersion(state, view.version)!
    return { ...view, measures, experiment_verdicts: judgeExperiments(workflow, deliveredItems) }
  }

  private async startWorkItem(projectDir: string, args: z.infer<typeof WorkStartArgs>): Promise<ToolResult> {
    const started = await this.withProjectLock(projectDir, async (projectId) => {
      const workflow = foldState(await this.ports.store.read(projectId)).workflow
      if (!workflow) throw new UserError(NO_WORKFLOW_YET)
      const agentToken = this.ports.ids.secret()
      const firstStage = workflow.stages[0]
      const position = firstStage && firstStage.steps.length > 0 ? { stage: firstStage.n, step: 1 } : { stage: null, step: null }
      const workItemId = this.ports.ids.next('wi')
      await this.appendEvent(projectId, {
        type: 'work_item_started',
        work_item_id: workItemId,
        issue: args.issue,
        description: args.description,
        workflow_version: workflow.version,
        token_hash: hashToken(agentToken),
        ...position,
      })
      const answer = { work_item_id: workItemId, agent_token: agentToken, workflow_version: workflow.version, ...position }
      return workResult(render.renderStarted({ workItemId, agentToken, issue: args.issue, workflow, position }), answer)
    })
    if (!args.start_at) return started
    const skipped = await this.skipToWorkStep(projectDir, {
      token: (started.structuredContent as { agent_token: string }).agent_token,
      start_at: args.start_at,
      justification: args.justification!,
      evidence: args.evidence!,
    })
    const startedHeader = started.content[0]!.text.split('\n## ')[0]!.trimEnd()
    return workResult(`${startedHeader}\n\n${skipped.content[0]!.text}`, { ...started.structuredContent, late_start: skipped.structuredContent })
  }

  private async skipToWorkStep(projectDir: string, args: z.infer<typeof WorkSkipArgs>): Promise<ToolResult> {
    const requested = await this.withProjectLock(projectDir, async (projectId) => {
      const state = foldState(await this.ports.store.read(projectId))
      const item = findWorkItemByTokenHash(state, hashToken(args.token))
      if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
      const request = (await this.appendEvent(projectId, requestLateStart(state, item, args))) as Extract<DrillmasterEvent, { type: 'late_start_requested' }>
      return { request, workItemId: item.work_item_id }
    })

    // Judged outside the project lock, like a Drillmaster gate.
    const events = await this.events(projectDir)
    const state = foldState(events)
    const item = state.workItems[requested.workItemId]!
    const workflow = work.workflowOfWorkItem(state, item)
    let judged: ReturnType<typeof readLateStartAnswer>
    try {
      const { answer } = await this.ports.reviewer.review({ kind: LATE_START_REVIEW_KIND, prompt: buildLateStartPrompt(workflow, item, requested.request, events) })
      judged = readLateStartAnswer(workflow, requested.request.skipped, answer)
    } catch (error) {
      judged = { accepted: false, why: `Drillmaster could not judge the late start (${error instanceof Error ? error.message : String(error)}).`, rule: null }
    }
    await this.withProjectLock(projectDir, (projectId) => this.appendEvent(projectId, { type: 'late_start_judged', work_item_id: item.work_item_id, by: 'drillmaster', ...judged }))

    const verdict = !judged.accepted ? 'rejected' : requested.request.owner_gates.length ? 'awaiting_owner' : 'skipped'
    const outcome: render.LateStartOutcome = { verdict, ...judged, skipped: requested.request.skipped, start_at: requested.request.start_at, first: firstPosition(workflow) }
    const askOwner = await this.ownerQuestionsFor(projectDir, item.work_item_id)
    const markdown = render.renderLateStart(workflow, outcome)
    return askOwner ? workResult(`${markdown}\n\n${render.renderAskOwner(askOwner)}`, { ...outcome, ask_owner: askOwner }) : workResult(markdown, outcome)
  }

  /** Shown on an item's next result after a major workflow change restarted it. */
  private restartNotice(state: ProjectState, item: WorkItemState) {
    if (!item.restarted) return undefined
    const from = findVersion(state, item.restarted.from_version)
    const to = work.workflowOfWorkItem(state, item)
    if (!from) return undefined
    return render.renderRestart({ from, to, changes: describeWorkflowChange(from, to), first: firstPosition(to) })
  }

  private async handleWorkTool(projectDir: string, toolName: string, toolArgs: unknown): Promise<ToolResult> {
    const artifactsToRead = toolName === 'work_deliver' ? parseToolArgs(WorkDeliverArgs, toolArgs).artifacts ?? [] : []
    const readArtifacts = await Promise.all(artifactsToRead.map((artifactPath) => readArtifactFromWorkFolder(projectDir, artifactPath)))

    const outcome = await this.withProjectLock(projectDir, async (projectId) => {
      const state = foldState(await this.ports.store.read(projectId))
      if (!state.workflow) throw new UserError(NO_WORKFLOW_YET)
      const { token, ...actionArgs } = toolArgs as { token?: unknown }
      const item = typeof token === 'string' ? findWorkItemByTokenHash(state, hashToken(token)) : undefined
      const restartNotice = item ? this.restartNotice(state, item) : undefined
      if (restartNotice && toolName === 'work_gate') throw new work.Refused(restartNotice)
      let decision: work.Decision
      switch (toolName) {
        case 'work_report':
          parseToolArgs(WorkReportArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          decision = work.recordReport(item, actionArgs as work.ReportArgs)
          break
        case 'work_gate':
          parseToolArgs(WorkGateArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          decision = work.handInGate(state, item, actionArgs as work.GateArgs)
          break
        case 'work_deliver': {
          const { pr, summary } = parseToolArgs(WorkDeliverArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          work.deliverWorkItem(item, { pr, summary, artifacts: [] })
          const artifacts = await Promise.all(readArtifacts.map((artifact) => this.ports.artifacts.save(projectId, item.work_item_id, artifact)))
          decision = work.deliverWorkItem(item, { pr, summary, artifacts })
          break
        }
        default:
          parseToolArgs(WorkPostMortemArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          decision = work.recordPostMortem(item, actionArgs as work.PostMortemArgs)
      }
      let gateSubmissionToJudge: string | undefined
      for (const newEvent of decision.events) {
        const storedEvent = await this.appendEvent(projectId, newEvent)
        if (storedEvent.type === 'gate_submitted' && storedEvent.gate === 'drillmaster') gateSubmissionToJudge = storedEvent.id
        if (storedEvent.type === 'gate_verdict' && storedEvent.accepted) this.takeDrillmasterMetricsInBackground(projectDir, storedEvent.work_item_id, storedEvent.stage, storedEvent.step)
        if (storedEvent.type === 'work_item_delivered') this.runInBackground(this.writeDrillmasterPostMortem(projectDir, storedEvent.work_item_id))
      }
      return { answer: decision.answer, gateSubmissionToJudge, workflow: work.workflowOfWorkItem(state, item!), workItemId: item!.work_item_id, restartNotice }
    })

    // A Drillmaster gate is judged outside the project lock, so hooks keep flowing meanwhile.
    const answer = outcome.gateSubmissionToJudge ? await this.judgeDrillmasterGate(projectDir, outcome.gateSubmissionToJudge) : outcome.answer
    const askOwner = await this.ownerQuestionsFor(projectDir, outcome.workItemId)
    let rendered = this.renderWorkAnswer(toolName, outcome.workflow, outcome.workItemId, answer as Record<string, unknown>)
    if (toolName === 'work_deliver') {
      const events = await this.events(projectDir)
      const due = retrospectiveDue(foldState(events), events)
      if (due) rendered += `\n\nA workflow retrospective is due: ${due}. Suggest it to Owner (/devops-drillmaster:retrospective); Owner decides when.`
    }
    const markdown = outcome.restartNotice ? `${rendered}\n\n${outcome.restartNotice}` : rendered
    if (!askOwner) return workResult(markdown, answer)
    return workResult(`${markdown}\n\n${render.renderAskOwner(askOwner)}`, { ...(answer as Record<string, unknown>), ask_owner: askOwner })
  }

  /** The AskUserQuestion input for the Owner questions a work item waits on, if any. */
  private async ownerQuestionsFor(projectDir: string, workItemId: string) {
    const questions = pendingOwnerQuestions(await this.state(projectDir)).filter((question) => 'work_item_id' in question && question.work_item_id === workItemId)
    return questions.length ? askUserQuestionInput(questions) : undefined
  }

  private renderWorkAnswer(toolName: string, workflow: WorkflowDocument, workItemId: string, answer: Record<string, unknown>) {
    switch (toolName) {
      case 'work_report':
        return render.renderReported(String(answer.recorded), { stage: answer.stage as number | null, step: answer.step as number | null })
      case 'work_gate':
        return render.renderGateOutcome(workflow, answer as unknown as render.GateOutcome)
      case 'work_deliver':
        return render.renderDelivered(workItemId, String(answer.pr), answer.artifacts as string[])
      default:
        return render.renderPostMortemRecorded(workItemId)
    }
  }

  private takeDrillmasterMetricsInBackground(projectDir: string, workItemId: string, stage: number, step: number) {
    this.runInBackground(
      (async () => {
        const events = await this.events(projectDir)
        const state = foldState(events)
        const item = state.workItems[workItemId]!
        const workflow = work.workflowOfWorkItem(state, item)
        const passedStep = workflow.stages[stage - 1]?.steps[step - 1]
        const metrics = dueDrillmasterMetrics(workflow, stage, step)
        if (metrics.length === 0 || passedStep?.gate === 'drillmaster') return
        const { answer } = await this.ports.reviewer.review({ kind: METRIC_REVIEW_KIND, prompt: buildMetricPrompt(workflow, item, stage, step, events) })
        await this.recordMetricAnswers(projectDir, workItemId, stage, step, readMetricAnswers(metrics, answer))
      })(),
    )
  }

  private recordMetricAnswers(projectDir: string, workItemId: string, stage: number, step: number, answers: readonly MetricAnswer[]) {
    return this.withProjectLock(projectDir, async (projectId) => {
      for (const metricAnswer of answers) {
        await this.appendEvent(projectId, { type: 'metric_recorded', work_item_id: workItemId, stage, step, ...metricAnswer, by: 'drillmaster' })
      }
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
      const proposalQuestions = pendingOwnerQuestions(foldState(await this.ports.store.read(projectId))).filter((question) => question.kind === 'proposal')
      return {
        ...toRetroView(storedEvent as Extract<DrillmasterEvent, { type: 'retrospective_ran' }>, retroResult.dropped),
        ...(proposalQuestions.length ? { ask_owner: askUserQuestionInput(proposalQuestions) } : {}),
        note: proposalQuestions.length
          ? 'Show Owner the findings and every proposal as they are, numbered. Then ask Owner to decide with AskUserQuestion, passing ask_owner exactly as it is (leave answers out). Owner decides; then apply the approved ones (workflow_retrospective apply).'
          : 'No workflow changes proposed. Show Owner the findings.',
      }
    })
  }

  private applyApprovedProposals(projectDir: string, onlyProposalId: number | undefined) {
    return this.withProjectLock(projectDir, async (projectId) => {
      const events = await this.ports.store.read(projectId)
      const state = foldState(events)
      const retro = state.latestRetroId ? state.retros[state.latestRetroId] : undefined
      if (!retro) throw new UserError('There is no workflow retrospective yet. Run one first.')
      if (onlyProposalId !== undefined) refuseUnapprovedProposal(retro, onlyProposalId)
      const toApply = onlyProposalId !== undefined ? [onlyProposalId] : retro.approved.filter((proposalId) => !retro.applied.includes(proposalId))
      if (toApply.length === 0) throw new UserError('Owner has approved no proposal that is still to apply. Ask Owner.', 403)

      let workflow = state.workflow!
      const activeItemVersions = new Map(Object.values(state.workItems).filter((item) => item.status === 'active').map((item) => [item.work_item_id, item.workflow_version]))
      const applied: { proposal: number; workflow_version: string; level: string; change: string; experiment: unknown }[] = []
      const restartedItemIds = new Set<string>()
      const appliedIds = [...retro.applied]
      for (const proposalId of [...toApply].sort((a, b) => a - b)) {
        const proposal = retro.proposals.find((candidate) => candidate.id === proposalId)!
        const unappliedDependencies = (proposal.depends_on ?? []).filter((dependencyId) => !appliedIds.includes(dependencyId))
        if (unappliedDependencies.length) {
          throw new UserError(`Proposal ${proposalId} builds on proposal ${unappliedDependencies.join(', ')}, which is not applied. Owner must approve ${unappliedDependencies.length > 1 ? 'those' : 'it'} too.`, 409)
        }
        const changed = applyProposal(workflow, proposal, measureDeliveredItems(events), this.ports.clock.now().slice(0, 10))
        await this.appendEvent(projectId, { type: 'workflow_changed', workflow: changed.workflow, reason: proposal.change, level: changed.level, retro_id: retro.retro_id, proposal: proposalId })
        const openedExperiment = changed.workflow.experiments.find((experiment) => !workflow.experiments.some((earlier) => earlier.id === experiment.id))
        applied.push({ proposal: proposalId, workflow_version: changed.workflow.version, level: changed.level, change: proposal.change, experiment: openedExperiment ?? null })
        if (changed.level === 'major') {
          for (const [workItemId, fromVersion] of activeItemVersions) {
            await this.appendEvent(projectId, { type: 'work_item_restarted', work_item_id: workItemId, from_version: fromVersion, to_version: changed.workflow.version })
            activeItemVersions.set(workItemId, changed.workflow.version)
            restartedItemIds.add(workItemId)
          }
        }
        appliedIds.push(proposalId)
        workflow = changed.workflow
      }
      return { applied, workflow_version: workflow.version, restarted: [...restartedItemIds] }
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
      for (const metricAnswer of judgement.metrics) {
        await this.appendEvent(projectId, { type: 'metric_recorded', ...gatePosition, ...metricAnswer, by: 'drillmaster' })
      }
      const { verdict } = judgement
      await this.appendEvent(projectId, { type: 'gate_verdict', ...gatePosition, by: 'drillmaster', ...verdict })
      return { verdict: verdict.accepted ? 'accepted' : 'rejected', by: 'drillmaster', rule: verdict.rule, why: verdict.why, stage: submission.stage, step: submission.step, next: verdict.next, done: verdict.done }
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
      description: item.description,
      metrics: item.metrics,
      skipped_steps: item.skipped_steps,
      late_start: item.late_start,
      restarted: item.restarted,
    }
    const verdicts = events.filter((event) => event.type === 'gate_verdict' && event.work_item_id === item.work_item_id)
    status.last_verdict = verdicts.at(-1) ?? null
    const ownerQuestions = pendingOwnerQuestions(state).filter((question) => !('work_item_id' in question) || question.work_item_id === item.work_item_id)
    if (ownerQuestions.length) status.ask_owner = askUserQuestionInput(ownerQuestions)
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

const jsonResult = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
})

const workResult = (markdown: string, answer: unknown): ToolResult => ({ content: [{ type: 'text', text: markdown }], structuredContent: answer as Record<string, unknown> })

function refuseUnapprovedProposal(retro: RetroState, proposalId: number) {
  if (!retro.proposals.some((candidate) => candidate.id === proposalId)) throw new UserError(`The latest retrospective has no proposal ${proposalId}.`)
  if (retro.applied.includes(proposalId)) throw new UserError(`Proposal ${proposalId} is already applied.`)
  if (!retro.approved.includes(proposalId)) {
    throw new UserError(
      retro.declined.includes(proposalId) ? `Owner declined proposal ${proposalId}.` : `Owner has not approved proposal ${proposalId}. Only Owner's own words approve it: ask Owner.`,
      403,
    )
  }
}
