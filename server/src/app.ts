import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { InvalidArtifact, readArtifactFromWorkFolder } from './adapters/artifacts.js'
import { defaultFolderOf, projectKey } from './adapters/projects.js'
import { RepositoryConflict, RepositoryPublisher } from './adapters/repositoryPublisher.js'
import { isPublishMoment } from './core/repositoryLayout.js'
import { REPORT_KINDS, type DrillmasterEvent, type GateSubmitted, type InputAnswer, type NewEvent, type StepSkipRequested } from './core/events.js'
import { judgeExperiments } from './core/experiments.js'
import { FEEDBACK_REFS_HELP, FeedbackInput, migrateEvent, ReflectionInput, resolveFeedback } from './core/feedback.js'
import { handleHook, HOOK_EVENTS, type HookPayload } from './core/hooks.js'
import { averageMeasure, BASELINE_WINDOW, currentMeasureName, MEASURE_NAMES, measureDeliveredItems } from './core/measures.js'
import { buildFrictionPrompt, FRICTION_REVIEW_KIND, readFrictionAnswer } from './core/friction.js'
import { frictionJudgementsOf, ownerInputsOf } from './core/ownerInputs.js'
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
import { askUserQuestionInput, pendingOwnerQuestions } from './core/questions.js'
import { InvalidReference, parseRef, refOfGuid, resolveRef, stepPosition } from './core/refs.js'
import * as render from './core/render.js'
import {
  buildGatePrompt,
  buildInputPrompt,
  buildSkipPrompt,
  readSkipAnswer,
  SKIP_REVIEW_KIND,
  GATE_REVIEW_KIND,
  InvalidAnswer,
  INPUT_REVIEW_KIND,
  readGateAnswer,
  readInputAnswers,
} from './core/review.js'
import {
  findVersion,
  findWorkItemByTokenHash,
  foldState,
  viewWorkflow,
  WorkflowQueryError,
  workReportsOf,
  workTracesOf,
  type ProjectState,
  type RetroState,
} from './core/state.js'
import { componentHistory } from './core/history.js'
import * as views from './core/views.js'
import * as work from './core/work.js'
import { AT_START, Objective, toSemver, workflowZero, type WorkflowDocument } from './core/workflow.js'
import type { Ports, ProjectRef } from './ports.js'
import { VERSION } from './version.js'

const POST_MORTEM_TIMEOUT_MS = 180_000
const RETROSPECTIVE_TIMEOUT_MS = 300_000
const MAX_LAST_REPORTS = 200
const MAX_ARTIFACTS = 10
const NO_WORKFLOW_YET = 'This project has no workflow yet. Owner sets the objective first (setup).'
export const NOT_A_PROJECT = 'This folder is not a Drillmaster project: it has no .drillmaster file. Owner sets it up with /devops-drillmaster:setup, which is the only thing Drillmaster does here until then.'
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
}

export interface DrillmasterOptions {
  recordRawHookPayloads?: boolean
  /** Who this server writes as in Drillmaster repositories, and where it keeps each project's clone. */
  repositories?: { writer: string; projectsRoot: string }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const StageRefArg = z.union([z.string().min(1), z.number().int().positive()]).transform(String)
const StepRefArg = z.string().min(1)

const WorkflowGetArgs = z
  .object({
    stage: StageRefArg.optional(),
    full: z.boolean().optional(),
    version: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  })
  .strict()

const tokenField = z.string().min(1)
const textField = z.string().min(1)
const InputAnswerArgs = z.object({ name: textField, value: textField, explanation: z.string().optional() }).strict()

const WorkStartArgs = z.object({ issue: textField, description: textField, stages: z.array(StageRefArg).optional(), inputs: z.array(InputAnswerArgs).optional() }).strict()
const WorkInputArgs = z.object({ token: tokenField, name: textField, value: textField, why: textField }).strict()
const WorkResumeArgs = z.object({ issue: textField, stages: z.array(StageRefArg).optional() }).strict()
const WorkSkipArgs = z.object({ token: tokenField, step: StepRefArg, why: textField }).strict()
const WorkReportArgs = z
  .object({
    token: tokenField,
    kind: z.enum(REPORT_KINDS),
    text: textField,
    step: StepRefArg.optional(),
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
    step: StepRefArg,
    self_check: z.array(z.object({ rule: z.string().min(1), accepted: z.boolean(), evidence: textField }).strict()).default([]),
    text: textField,
    inputs: z.array(InputAnswerArgs).optional(),
  })
  .strict()
const WorkDeliverArgs = z.object({ token: tokenField, pr: textField, summary: textField, artifacts: z.array(textField).max(MAX_ARTIFACTS).optional() }).strict()
const WorkPostMortemArgs = z.object({ token: tokenField, keep: z.array(FeedbackInput), change: z.array(FeedbackInput), experiment_reflections: z.array(ReflectionInput) }).strict()

const RetroArgs = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('setup'),
      objective: z.string().min(1),
      measures: z.array(z.string()).min(1),
      drillmaster_repository: z.string().min(1),
      folder: z.string().regex(/^[A-Za-z0-9_-]+$/, 'a folder name has letters, digits, _ and - only').optional(),
    })
    .strict(),
  z.object({ action: z.literal('run') }).strict(),
  z.object({ action: z.literal('apply'), proposal: z.number().int().positive().optional() }).strict(),
])

const WorkStatusArgs = z
  .object({
    token: tokenField,
    last: z.number().int().positive().max(MAX_LAST_REPORTS).optional(),
    stage: StageRefArg.optional(),
    step: StepRefArg.optional(),
  })
  .strict()

const tokenProperty = { token: { type: 'string', description: 'Your agent_token from work_start.' } }
const sessionStagesProperty = {
  type: 'array',
  items: { type: 'string' },
  description: 'The work stages this session works on, by number (workflow_get lists them by name).',
}
const inputAnswersProperty = (where: string) => ({
  type: 'array',
  description: `The work item inputs that are yours to set ${where}, one option each (workflow_get lists the inputs). Work can't go on without them.`,
  items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, explanation: { type: 'string' } }, required: ['name', 'value'] },
})
const feedbackItemSchema = {
  type: 'object',
  properties: { refs: { type: 'array', items: { type: 'string' }, description: 'What it is about, e.g. "step 1.2", "rule pr 1.1", "tool work_deliver".' }, text: { type: 'string' } },
  required: ['refs', 'text'],
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
      "Describes the workflow, which is the same for everyone in the project. With no arguments: Owner's objective and measures, the work stages with their purpose and when they apply (if), the work item inputs, and the running workflow experiments. With `stage`: that work stage's work steps, each with its instruction, its work gate, the full text of the rules it checks, and what to report. With `full`: the whole workflow. With `version`: an earlier workflow version, e.g. \"1.0.0\".",
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'The work stage, by number, e.g. "1".' },
        full: { type: 'boolean', description: 'Return the whole workflow.' },
        version: { type: 'string', description: 'An earlier workflow version (major.minor.patch); 0.0.0 is the first.' },
      },
    },
  },
  {
    name: 'work_start',
    description:
      'Starts a work item at the first work step that applies to it. Returns its id, your agent_token for every later work tool, and that work step in full: what to do, the gate, its rules, and what to report. stages: the work stages this session works on, as Owner asked (e.g. ["1"]); the session stops when the last of them is done. Leave it out to work every stage. inputs: the work item inputs set at start that are yours to set.',
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'The issue the work item delivers, e.g. "#12".' },
        description: { type: 'string', description: 'What the work item is about, in a few sentences: the problem and the expected result.' },
        stages: sessionStagesProperty,
        inputs: inputAnswersProperty('at start'),
      },
      required: ['issue', 'description'],
    },
  },
  {
    name: 'work_resume',
    description:
      "Takes up an open work item in a later session, where it was left: the work stages Owner asked this session to do (e.g. [\"2\", \"3\"]). Returns a new agent_token, which voids the earlier one, and the step to do in full. If the step allows an update and the workflow changed since, the work item moves to the latest version first.",
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'The issue of the work item, as it was started, e.g. "#12".' },
        stages: sessionStagesProperty,
      },
      required: ['issue'],
    },
  },
  {
    name: 'work_skip',
    description:
      "Skips the work step you are at, when the workflow marks it as skippable and this work item doesn't need it. The step says who decides: you (skipped at once), Drillmaster (judged from your reason and the work traces), or Owner (asked in AskUserQuestion). Returns the decision and the step to do next.",
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        step: { type: 'string', description: 'The step you are at, e.g. "2.3".' },
        why: { type: 'string', description: "Why this work item doesn't need the step." },
      },
      required: ['token', 'step', 'why'],
    },
  },
  {
    name: 'work_input',
    description:
      "Sets or changes a work item input that is yours to set, once its place has passed: for example when the work shows that a 'feature' is a bug. why: what showed it. When the change makes a step that was skipped by its if apply, the work item goes back to the first such step, keeping the steps before it that were done. Returns where the work item is.",
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        name: { type: 'string', description: 'The input, e.g. "kind".' },
        value: { type: 'string', description: 'One of its options.' },
        why: { type: 'string' },
      },
      required: ['token', 'name', 'value', 'why'],
    },
  },
  {
    name: 'work_report',
    description: [
      'Report to Drillmaster in real time, while you work.',
      'kind: impediment | better_way | decision (+ chosen, by, why) | question (+ asked, answer) | assumption | required | added_step (+ why).',
      'step: the work step it is about, e.g. "1.2"; it defaults to where the work item is.',
      "added_step is the only report after delivery: a fix Owner asked for and chose to have done right away. text: what you did; why: Owner's correction.",
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        kind: { type: 'string', enum: [...REPORT_KINDS] },
        text: { type: 'string' },
        step: { type: 'string', description: 'The work step, e.g. "1.2".' },
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
      "Hands in the work gate of the current work step (step, e.g. \"1.2\"), once its work is done. self_check holds exactly one {rule, accepted, evidence} per rule the gate checks, and is left out at an Owner gate, which Owner judges; text is what the step requires reporting, and at an Owner gate what Owner should look at; inputs sets the work item inputs that are yours to set at this step. Returns the verdict and the next work step in full.",
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        step: { type: 'string', description: 'The work step, e.g. "1.2".' },
        self_check: selfCheckProperty,
        text: { type: 'string' },
        inputs: inputAnswersProperty('at this step'),
      },
      required: ['token', 'step', 'text'],
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
    description: `Your workflow post mortem, after delivery: lists of what in the workflow helped (keep), what got in the way and how to change it (change), and how each running experiment did (experiment_reflections). In each keep and change entry, ${FEEDBACK_REFS_HELP}`,
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        keep: { type: 'array', items: feedbackItemSchema },
        change: { type: 'array', items: feedbackItemSchema },
        experiment_reflections: {
          type: 'array',
          items: { type: 'object', properties: { experiment: { type: 'integer', minimum: 1 }, text: { type: 'string' } }, required: ['experiment', 'text'] },
        },
      },
      required: ['token', 'keep', 'change', 'experiment_reflections'],
    },
  },
  {
    name: 'workflow_retrospective',
    description: [
      'The only place the workflow changes. Owner calls for it, and Drillmaster carries it out.',
      `- setup {objective, measures, drillmaster_repository, folder}: once per project, when Owner sets the objective. Creates workflow 0.0.0, which holds only the objective, in the Drillmaster repository, and writes .drillmaster in the work folder. measures: ${MEASURE_NAMES.join(', ')}.`,
      `- run: Drillmaster's findings (should, did, why, and keep and improve as lists that name what each is about) and at most ${MAX_PROPOSALS} numbered proposals, from the post mortems, work reports, Owner's inputs, the measures and the experiments' verdicts. Show them to Owner as they are.`,
      "- apply: applies every proposal Owner approved, in order (or only `proposal`). Each makes the next workflow version and opens a workflow experiment with its measure's baseline.",
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['setup', 'run', 'apply'] },
        objective: { type: 'string', description: 'setup: what Owner wants Drillmaster to achieve with the workflow.' },
        measures: { type: 'array', items: { type: 'string', enum: [...MEASURE_NAMES] }, description: 'setup: the measures of the objective.' },
        drillmaster_repository: { type: 'string', description: "setup: the private git repository (URL or path) that keeps the project's workflow and history: the Drillmaster repository." },
        folder: { type: 'string', description: "setup: the project's folder in the Drillmaster repository (default: the work folder's name). One repository can hold several projects." },
        proposal: { type: 'integer', minimum: 1, description: 'apply: only this proposal from the latest run.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'work_status',
    description:
      'Where a work item is: its work stage, work step and pending work gate. With `last`: also the last n work reports. With `step` (e.g. "1.2") or `stage` (e.g. "1"): also the work reports and work traces captured there.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tokenProperty,
        last: { type: 'integer', minimum: 1, maximum: MAX_LAST_REPORTS },
        stage: { type: 'string', description: 'A work stage, e.g. "1".' },
        step: { type: 'string', description: 'A work step, e.g. "1.2".' },
      },
      required: ['token'],
    },
  },
]

const TOOL_NAMES = TOOLS.map((tool) => tool.name)

export class Drillmaster {
  private readonly lockByProject = new Map<string, Promise<unknown>>()
  private readonly knownVersionsByProject = new Map<string, KnownVersions>()
  private readonly publishChainByProject = new Map<string, Promise<void>>()
  private readonly repositoryProblemByProject = new Map<string, string>()
  private readonly projectDirsSeen = new Set<string>()
  private readonly backgroundWork = new Set<Promise<unknown>>()

  private readonly ports: Ports

  constructor(
    ports: Ports,
    private readonly options: DrillmasterOptions = {},
  ) {
    // Every event is read as the current version of Drillmaster writes it.
    this.ports = { ...ports, store: { ...ports.store, read: async (projectId) => (await ports.store.read(projectId)).map(migrateEvent), append: (projectId, event) => ports.store.append(projectId, event), projectIds: () => ports.store.projectIds() } }
  }

  projectKeyOf(projectDir: string) {
    return this.ports.projects.resolve(projectDir)?.key
  }

  private projectOf(projectDir: string): ProjectRef {
    const project = this.ports.projects.resolve(projectDir)
    if (!project) throw new UserError(NOT_A_PROJECT, 404)
    return project
  }

  private withProjectLock<T>(projectDir: string, criticalSection: (projectId: string, project: ProjectRef) => Promise<T>): Promise<T> {
    const project = this.projectOf(projectDir)
    const previousRun = this.lockByProject.get(project.key) ?? Promise.resolve()
    const thisRun = previousRun.then(() => criticalSection(project.key, project))
    this.lockByProject.set(project.key, thisRun.catch(() => {}))
    return thisRun
  }

  /** The versions events of a project are made under, kept as events are appended. */
  private async versionsOf(projectId: string): Promise<KnownVersions> {
    let known = this.knownVersionsByProject.get(projectId)
    if (!known) {
      const state = foldState(await this.ports.store.read(projectId))
      known = { workflow: state.workflow?.version, items: new Map(Object.values(state.workItems).map((item) => [item.work_item_id, item.workflow_version])) }
      this.knownVersionsByProject.set(projectId, known)
    }
    return known
  }

  private async appendEvent(project: ProjectRef, newEvent: NewEvent): Promise<DrillmasterEvent> {
    const known = await this.versionsOf(project.key)
    const workItemId = 'work_item_id' in newEvent && typeof newEvent.work_item_id === 'string' ? newEvent.work_item_id : undefined
    const madeUnder = (workItemId ? known.items.get(workItemId) : undefined) ?? known.workflow
    const storedEvent = {
      id: this.ports.ids.next('ev'),
      at: this.ports.clock.now(),
      ...(madeUnder ? { workflow_version: madeUnder } : {}),
      drillmaster_version: VERSION,
      ...(this.options.repositories ? { writer: this.options.repositories.writer } : {}),
      ...newEvent,
    } as DrillmasterEvent
    await this.ports.store.append(project.key, storedEvent)
    if (isPublishMoment(storedEvent)) this.publishInBackground(project)
    if (storedEvent.type === 'project_initialized' || storedEvent.type === 'workflow_changed') known.workflow = toSemver(storedEvent.workflow.version)
    if (storedEvent.type === 'work_item_started') known.items.set(storedEvent.work_item_id, toSemver(storedEvent.workflow_version))
    if (storedEvent.type === 'work_item_updated') known.items.set(storedEvent.work_item_id, storedEvent.to_version)
    return storedEvent
  }

  /** The project's Drillmaster repository, when the project has one and this server writes to repositories. */
  private publisherFor(project: ProjectRef) {
    if (!project.repository || !this.options.repositories) return undefined
    return RepositoryPublisher.forProject(this.options.repositories.projectsRoot, project.key, project.repository, this.options.repositories.writer)
  }

  /** One change to the repository at a time per project: publishes, workflow pushes and pins. */
  private inRepositoryChain<T>(project: ProjectRef, change: () => Promise<T>): Promise<T> {
    const previous = this.publishChainByProject.get(project.key) ?? Promise.resolve()
    const thisChange = previous.then(change)
    this.publishChainByProject.set(
      project.key,
      thisChange.then(
        () => {},
        () => {},
      ),
    )
    return thisChange
  }

  /** A failure is kept to tell Agent, and the next publish retries it. */
  private publishInBackground(project: ProjectRef) {
    const publisher = this.publisherFor(project)
    if (!publisher) return
    this.runInBackground(
      this.inRepositoryChain(project, async () => {
        const events = await this.ports.store.read(project.key)
        try {
          await publisher.publish(events, (workItemId, name) => this.ports.artifacts.read(project.key, workItemId, name))
          this.repositoryProblemByProject.delete(project.key)
        } catch (error) {
          this.repositoryProblemByProject.set(project.key, error instanceof Error ? error.message : String(error))
        }
      }),
    )
  }

  /** Fetches what other machines pushed, for every project this server has seen, every `intervalMs`. */
  syncRepositoriesEvery(intervalMs: number) {
    const timer = setInterval(() => {
      for (const projectDir of this.projectDirsSeen) this.runInBackground(this.importFromRepository(projectDir))
    }, intervalMs)
    timer.unref()
    return () => clearInterval(timer)
  }

  private async importFromRepository(projectDir: string) {
    const project = this.ports.projects.resolve(projectDir)
    const publisher = project && this.publisherFor(project)
    if (!project || !publisher) return
    let imported: DrillmasterEvent[]
    try {
      imported = await publisher.importEvents()
    } catch (error) {
      this.repositoryProblemByProject.set(project.key, error instanceof Error ? error.message : String(error))
      return
    }
    await this.withProjectLock(projectDir, async (projectId, project) => {
      const knownIds = new Set((await this.ports.store.read(projectId)).map((event) => event.id))
      const unseen = [...new Map(imported.filter((event) => !knownIds.has(event.id)).map((event) => [event.id, event])).values()].sort((a, b) => a.at.localeCompare(b.at))
      for (const event of unseen) await this.ports.store.append(projectId, event)
      if (unseen.length) this.knownVersionsByProject.delete(projectId)
    })
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
    return this.ports.store.read(this.projectOf(projectDir).key)
  }

  async state(projectDir: string): Promise<ProjectState> {
    return foldState(await this.events(projectDir))
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

  async componentHistory(projectId: string, guid: string) {
    const history = componentHistory(await this.ports.store.read(projectId), guid)
    if (!history) throw new UserError(`No workflow component ${guid} in project ${projectId}`, 404)
    return history
  }

  async artifact(projectId: string, workItemId: string, name: string) {
    const item = foldState(await this.ports.store.read(projectId)).workItems[workItemId]
    const recorded = item?.artifacts.find((artifact) => artifact.name === name)
    const bytes = recorded ? await this.ports.artifacts.read(projectId, workItemId, name) : undefined
    if (!recorded || !bytes) throw new UserError(`No artifact ${name} on work item ${workItemId}`, 404)
    return { mediaType: recorded.media_type, bytes }
  }

  /**
   * Sets a work folder up as a Drillmaster project: the pin and workflow 0.0.0 are pushed to the
   * Drillmaster repository first, then `.drillmaster` names it in the work folder.
   */
  async init(projectDir: string, objective: unknown, repository: { url: string; folder?: string }) {
    const parsedObjective = Objective.safeParse(objective)
    if (!parsedObjective.success) throw new UserError(`Invalid objective: ${z.prettifyError(parsedObjective.error)}`)
    const existing = this.ports.projects.resolve(projectDir)
    const place = { url: repository.url, folder: repository.folder ?? existing?.repository?.folder ?? defaultFolderOf(projectDir) }
    if (existing?.repository && (existing.repository.url !== place.url || existing.repository.folder !== place.folder)) {
      throw new UserError(`This folder belongs to the project in ${existing.repository.url} (folder ${existing.repository.folder}), as its .drillmaster says. Setup doesn't move it to another one.`, 409)
    }
    if (existing && foldState(await this.ports.store.read(existing.key)).initialized) {
      throw new UserError('This project already has a workflow. It changes only at a workflow retrospective.', 409)
    }
    const workflow = workflowZero(parsedObjective.data)
    const candidate: ProjectRef = { key: projectKey(place), repository: place }
    const publisher = this.publisherFor(candidate)
    if (publisher) {
      await publisher.setUp(workflow, VERSION).catch((error: unknown) => {
        if (error instanceof RepositoryConflict) throw new UserError(error.message, 409)
        throw new UserError(`The Drillmaster repository ${place.url} does not take a push from Drillmaster: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    const project = await this.ports.projects.link(projectDir, place)
    await this.withProjectLock(projectDir, () => this.appendEvent(project, { type: 'project_initialized', dir: path.resolve(projectDir), workflow }))
    return { workflow, project }
  }

  async hook(projectDir: string, hookEvent: string, payload: unknown) {
    if (!(HOOK_EVENTS as readonly string[]).includes(hookEvent)) throw new UserError(`Unknown hook event: ${hookEvent}`, 404)
    if (typeof payload !== 'object' || payload === null) throw new UserError('The hook payload must be a JSON object')
    // A folder without .drillmaster isn't traced.
    if (!this.ports.projects.resolve(projectDir)) return { stored: 0, output: undefined }
    return this.withProjectLock(projectDir, async (projectId, project) => {
      const events = await this.ports.store.read(projectId)
      const state = foldState(events)
      const context = hookEvent === 'SessionStart' ? { retrospectiveDue: retrospectiveDue(state, events), repositoryProblem: this.repositoryProblemByProject.get(projectId) } : {}
      if (hookEvent === 'SessionStart') this.runInBackground(this.importFromRepository(projectDir))
      this.projectDirsSeen.add(projectDir)
      const outcome = handleHook(state, hookEvent, payload as HookPayload, this.options.recordRawHookPayloads ?? false, context)
      for (const event of outcome.events) await this.appendEvent(project, event)
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
        case 'work_resume':
          return await this.resumeWorkItem(projectDir, parseToolArgs(WorkResumeArgs, toolArgs))
        case 'work_skip':
          return await this.skipStep(projectDir, parseToolArgs(WorkSkipArgs, toolArgs))
        case 'work_input':
          return await this.changeInput(projectDir, parseToolArgs(WorkInputArgs, toolArgs))
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
            const { workflow } = await this.init(projectDir, { text: retroArgs.objective, measures: retroArgs.measures.map(currentMeasureName) }, { url: retroArgs.drillmaster_repository, folder: retroArgs.folder })
            return jsonResult({
              workflow,
              note: 'Workflow 0.0.0 holds only the objective. Agent does its best, Owner steps in where needed, and the workflow grows from that. Commit .drillmaster with the code: it is how Drillmaster knows this folder.',
            })
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
        error instanceof InvalidArtifact ||
        error instanceof InvalidReference
      if (isCallersMistake) return { content: [{ type: 'text', text: error.message }], isError: true }
      throw error
    }
  }

  private async describeWorkflow(projectDir: string, query: z.infer<typeof WorkflowGetArgs>) {
    const events = await this.events(projectDir)
    const state = foldState(events)
    const view = viewWorkflow(state, { ...query, stage: query.stage === undefined ? undefined : Number(parseRef(query.stage, 'stage').name), version: query.version === undefined ? undefined : toSemver(query.version) })
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
    const started = await this.withProjectLock(projectDir, async (projectId, project) => {
      const workflow = foldState(await this.ports.store.read(projectId)).workflow
      if (!workflow) throw new UserError(NO_WORKFLOW_YET)
      const firstStage = workflow.stages[0]
      const position = firstStage && firstStage.steps.length > 0 ? { stage: firstStage.n, step: 1 } : { stage: null, step: null }
      const stageGuids = args.stages && stageGuidsOf(workflow, args.stages)
      if (stageGuids && firstStage && !stageGuids.includes(firstStage.guid)) {
        throw new UserError(`A work item starts at step 1.1, in stage 1 "${firstStage.name}", which isn't among the stages you named. To go on with an open work item, use work_resume.`)
      }
      work.agentInputEvents(workflow, '', AT_START, args.inputs ?? [], 'in work_start (inputs)')
      const agentToken = this.ports.ids.secret()
      const workItemId = this.ports.ids.next('wi')
      await this.appendEvent(project, {
        type: 'work_item_started',
        work_item_id: workItemId,
        issue: args.issue,
        description: args.description,
        workflow_version: workflow.version,
        token_hash: hashToken(agentToken),
        ...position,
        ...(stageGuids ? { stage_guids: stageGuids } : {}),
      })
      for (const inputEvent of work.agentInputEvents(workflow, workItemId, AT_START, args.inputs ?? [], 'in work_start (inputs)')) await this.appendEvent(project, inputEvent)
      const state = foldState(await this.ports.store.read(projectId))
      const moved = work.moveOn(state, state.workItems[workItemId]!, workflow, { next: position, done: position.stage === null }, { alreadyThere: true })
      for (const movedEvent of moved.events) await this.appendEvent(project, movedEvent)
      const move = work.describeMove(moved)
      const answer = { work_item_id: workItemId, agent_token: agentToken, workflow_version: workflow.version, ...moved.next, ...move }
      const sessionStages = stageGuids ? namesOfStages(workflow, stageGuids) : undefined
      return {
        markdown: render.renderStarted({ workItemId, agentToken, issue: args.issue, workflow, move, sessionStages }),
        answer,
        workItemId,
      }
    })
    this.takeDrillmasterInputsInBackground(projectDir, started.workItemId, null, undefined)
    const askOwner = await this.ownerQuestionsFor(projectDir, started.workItemId)
    return askOwner ? workResult(`${started.markdown}\n\n${render.renderAskOwner(askOwner)}`, { ...started.answer, ask_owner: askOwner }) : workResult(started.markdown, started.answer)
  }

  private async changeInput(projectDir: string, args: z.infer<typeof WorkInputArgs>): Promise<ToolResult> {
    const changed = await this.withProjectLock(projectDir, async (projectId, project) => {
      const state = foldState(await this.ports.store.read(projectId))
      const item = findWorkItemByTokenHash(state, hashToken(args.token))
      if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
      const decision = work.changeInput(state, item, args)
      for (const newEvent of decision.events) await this.appendEvent(project, newEvent)
      const after = foldState(await this.ports.store.read(projectId))
      return { answer: decision.answer, workflow: work.workflowOfWorkItem(after, after.workItems[item.work_item_id]!), workItemId: item.work_item_id }
    })
    const markdown = render.renderInputChanged(changed.workflow, changed.answer as unknown as render.InputChange)
    const askOwner = await this.ownerQuestionsFor(projectDir, changed.workItemId)
    return askOwner ? workResult(`${markdown}\n\n${render.renderAskOwner(askOwner)}`, { ...changed.answer, ask_owner: askOwner }) : workResult(markdown, changed.answer)
  }

  private async resumeWorkItem(projectDir: string, args: z.infer<typeof WorkResumeArgs>): Promise<ToolResult> {
    const resumed = await this.withProjectLock(projectDir, async (projectId, project) => {
      const state = foldState(await this.ports.store.read(projectId))
      const item = Object.values(state.workItems)
        .filter((candidate) => candidate.issue === args.issue && (candidate.status === 'active' || !candidate.post_mortems.includes('agent')))
        .sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
      if (!item) throw new UserError(`No open work item has issue "${args.issue}". Start one with work_start.`)
      const workflow = work.workflowOfWorkItem(state, item)
      const stageGuids = args.stages && stageGuidsOf(workflow, args.stages)
      const agentToken = this.ports.ids.secret()
      await this.appendEvent(project, { type: 'work_item_resumed', work_item_id: item.work_item_id, token_hash: hashToken(agentToken), ...(stageGuids ? { stage_guids: stageGuids } : {}) })
      const resumedItem = foldState(await this.ports.store.read(projectId)).workItems[item.work_item_id]!
      const canMoveOn = resumedItem.status === 'active' && !resumedItem.pending_gate && !resumedItem.pending_skip && resumedItem.stage !== null
      const moved = canMoveOn ? work.moveOn(foldState(await this.ports.store.read(projectId)), resumedItem, workflow, { next: { stage: item.stage, step: item.step }, done: item.gates_done }) : undefined
      for (const movedEvent of moved?.events ?? []) await this.appendEvent(project, movedEvent)
      const update = moved?.update
      const after = foldState(await this.ports.store.read(projectId))
      const current = after.workItems[item.work_item_id]!
      const currentWorkflow = work.workflowOfWorkItem(after, current)
      const move = moved ? work.describeMove(moved) : { next: { stage: current.stage, step: current.step }, done: current.gates_done, ...waitingForInputsOf(currentWorkflow, current) }
      const answer = { work_item_id: current.work_item_id, agent_token: agentToken, workflow_version: current.workflow_version, stage: current.stage, step: current.step, ...move }
      const markdown = render.renderResumed({
        workItemId: current.work_item_id,
        agentToken,
        issue: current.issue,
        workflow: currentWorkflow,
        item: current,
        sessionStages: work.sessionStagesOf(currentWorkflow, current),
        outsideSession: work.outsideSessionStages(currentWorkflow, current, current),
        update: update && work.describeUpdate(update),
        move,
      })
      return { markdown, answer, workItemId: current.work_item_id }
    })
    const askOwner = await this.ownerQuestionsFor(projectDir, resumed.workItemId)
    return askOwner ? workResult(`${resumed.markdown}\n\n${render.renderAskOwner(askOwner)}`, { ...resumed.answer, ask_owner: askOwner }) : workResult(resumed.markdown, resumed.answer)
  }

  private async skipStep(projectDir: string, args: z.infer<typeof WorkSkipArgs>): Promise<ToolResult> {
    const requested = await this.withProjectLock(projectDir, async (projectId, project) => {
      const state = foldState(await this.ports.store.read(projectId))
      const item = findWorkItemByTokenHash(state, hashToken(args.token))
      if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
      const decision = work.requestSkip(state, item, { ...stepOfRef(work.workflowOfWorkItem(state, item), args.step), why: args.why })
      for (const newEvent of decision.events) await this.appendEvent(project, newEvent)
      return { answer: decision.answer as unknown as render.SkipOutcome, workItemId: item.work_item_id }
    })
    const answer = requested.answer.skip === 'pending' && requested.answer.decided_by === 'drillmaster' ? await this.judgeSkip(projectDir, requested.workItemId) : requested.answer
    const state = await this.state(projectDir)
    const markdown = render.renderSkipOutcome(work.workflowOfWorkItem(state, state.workItems[requested.workItemId]!), answer)
    const askOwner = await this.ownerQuestionsFor(projectDir, requested.workItemId)
    return askOwner ? workResult(`${markdown}\n\n${render.renderAskOwner(askOwner)}`, { ...answer, ask_owner: askOwner }) : workResult(markdown, answer)
  }

  /** Judged outside the project lock, like a Drillmaster gate. */
  private async judgeSkip(projectDir: string, workItemId: string): Promise<render.SkipOutcome> {
    const events = await this.events(projectDir)
    const state = foldState(events)
    const item = state.workItems[workItemId]!
    const request = events.filter((event) => event.type === 'step_skip_requested' && event.work_item_id === workItemId).at(-1) as StepSkipRequested
    const workflow = work.workflowOfWorkItem(state, item)
    let verdict: { accepted: boolean; why: string }
    try {
      const { answer } = await this.ports.reviewer.review({ kind: SKIP_REVIEW_KIND, prompt: buildSkipPrompt(workflow, item, request, events) })
      verdict = readSkipAnswer(answer)
    } catch (error) {
      verdict = { accepted: false, why: `Drillmaster could not judge the skip (${error instanceof Error ? error.message : String(error)}). Do the step.` }
    }
    return this.withProjectLock(projectDir, async (projectId, project) => {
      const current = foldState(await this.ports.store.read(projectId))
      const currentItem = current.workItems[workItemId]!
      if (currentItem.pending_skip?.decided_by !== 'drillmaster') return { skip: 'pending', stage: request.stage, step: request.step, note: 'The skip was decided while Drillmaster judged it. Check work_status.' }
      const decision = work.decideSkip(current, currentItem, { ...verdict, by: 'drillmaster' })
      for (const newEvent of decision.events) await this.appendEvent(project, newEvent)
      return decision.answer as unknown as render.SkipOutcome
    })
  }

  private async handleWorkTool(projectDir: string, toolName: string, toolArgs: unknown): Promise<ToolResult> {
    const artifactsToRead = toolName === 'work_deliver' ? parseToolArgs(WorkDeliverArgs, toolArgs).artifacts ?? [] : []
    const readArtifacts = await Promise.all(artifactsToRead.map((artifactPath) => readArtifactFromWorkFolder(projectDir, artifactPath)))

    const outcome = await this.withProjectLock(projectDir, async (projectId, project) => {
      const state = foldState(await this.ports.store.read(projectId))
      if (!state.workflow) throw new UserError(NO_WORKFLOW_YET)
      const { token } = toolArgs as { token?: unknown }
      const item = typeof token === 'string' ? findWorkItemByTokenHash(state, hashToken(token)) : undefined
      let decision: work.Decision
      switch (toolName) {
        case 'work_report': {
          const { token: _token, step: stepRef, ...reportArgs } = parseToolArgs(WorkReportArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          const workflow = work.workflowOfWorkItem(state, item)
          decision = work.recordReport(workflow, item, { ...reportArgs, ...(stepRef === undefined ? {} : stepOfRef(workflow, stepRef)) })
          break
        }
        case 'work_gate': {
          const { token: _token, step: stepRef, ...gateArgs } = parseToolArgs(WorkGateArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          decision = work.handInGate(state, item, { ...gateArgs, ...stepOfRef(work.workflowOfWorkItem(state, item), stepRef) })
          break
        }
        case 'work_deliver': {
          const { pr, summary } = parseToolArgs(WorkDeliverArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          work.refuseUndeliverable(item)
          const artifacts = await Promise.all(readArtifacts.map((artifact) => this.ports.artifacts.save(projectId, item.work_item_id, artifact)))
          decision = work.deliverWorkItem(item, { pr, summary, artifacts })
          break
        }
        default: {
          const { token: _token, ...postMortem } = parseToolArgs(WorkPostMortemArgs, toolArgs)
          if (!item) throw new UserError(UNKNOWN_TOKEN, 403)
          const workflow = work.workflowOfWorkItem(state, item)
          decision = work.recordPostMortem(item, { ...postMortem, keep: resolveFeedback(workflow, postMortem.keep, TOOL_NAMES, 'refuse'), change: resolveFeedback(workflow, postMortem.change, TOOL_NAMES, 'refuse') })
        }
      }
      let gateSubmissionToJudge: string | undefined
      for (const newEvent of decision.events) {
        const storedEvent = await this.appendEvent(project, newEvent)
        if (storedEvent.type === 'gate_submitted' && storedEvent.gate === 'drillmaster') gateSubmissionToJudge = storedEvent.id
        if (storedEvent.type === 'gate_verdict' && storedEvent.accepted && storedEvent.by !== 'drillmaster') {
          this.takeDrillmasterInputsInBackground(projectDir, storedEvent.work_item_id, { stage: storedEvent.stage, step: storedEvent.step }, storedEvent.workflow_version)
        }
        if (storedEvent.type === 'work_item_delivered') {
          this.runInBackground(this.writeDrillmasterPostMortem(projectDir, storedEvent.work_item_id))
          this.runInBackground(this.judgeFriction(projectDir, storedEvent.work_item_id))
        }
      }
      const after = foldState(await this.ports.store.read(projectId))
      return { answer: decision.answer, gateSubmissionToJudge, workflow: work.workflowOfWorkItem(after, after.workItems[item!.work_item_id]!), workItemId: item!.work_item_id }
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
    if (!askOwner) return workResult(rendered, answer)
    return workResult(`${rendered}\n\n${render.renderAskOwner(askOwner)}`, { ...(answer as Record<string, unknown>), ask_owner: askOwner })
  }

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

  /**
   * Drillmaster's inputs of a work item that started (`at` null), or passed a step another gate
   * than Drillmaster's decided, in the workflow version it was on then.
   */
  private takeDrillmasterInputsInBackground(projectDir: string, workItemId: string, at: { stage: number; step: number } | null, workflowVersion: string | undefined) {
    this.runInBackground(
      (async () => {
        const events = await this.events(projectDir)
        const state = foldState(events)
        const item = state.workItems[workItemId]!
        const workflow = (workflowVersion && findVersion(state, workflowVersion)) || work.workflowOfWorkItem(state, item)
        const due = work.inputsSetAt(workflow, at ? `${at.stage}.${at.step}` : AT_START, 'drillmaster')
        if (due.length === 0) return
        const { answer } = await this.ports.reviewer.review({ kind: INPUT_REVIEW_KIND, prompt: buildInputPrompt(workflow, item, at, events) })
        await this.recordDrillmasterInputs(projectDir, workItemId, at, readInputAnswers(due, answer))
      })(),
    )
  }

  private recordDrillmasterInputs(projectDir: string, workItemId: string, at: { stage: number; step: number } | null, answers: readonly InputAnswer[]) {
    if (answers.length === 0) return Promise.resolve()
    return this.withProjectLock(projectDir, async (projectId, project) => {
      const state = foldState(await this.ports.store.read(projectId))
      const events = work.inputEventsWithMove(state, state.workItems[workItemId]!, at, answers.map((answer) => ({ ...answer, by: 'drillmaster' as const })))
      for (const newEvent of events) await this.appendEvent(project, newEvent)
    })
  }

  /** The separate friction judge, on each of Owner's inputs on a work item it hasn't judged yet. */
  private async judgeFriction(projectDir: string, workItemId: string) {
    const events = await this.events(projectDir)
    const item = foldState(events).workItems[workItemId]!
    const judged = frictionJudgementsOf(events)
    const unjudged = ownerInputsOf(events).filter((input) => input.work_item_id === workItemId && !judged.has(input.event_id))
    if (unjudged.length === 0) return
    let judgements
    try {
      const { answer } = await this.ports.reviewer.review({ kind: FRICTION_REVIEW_KIND, prompt: buildFrictionPrompt(item, unjudged, events) })
      judgements = readFrictionAnswer(unjudged, answer)
    } catch {
      // Until the judge has judged, an input counts by what it led to.
      return
    }
    if (judgements.length === 0) return
    await this.withProjectLock(projectDir, (_projectId, project) => this.appendEvent(project, { type: 'owner_inputs_judged', work_item_id: workItemId, inputs: judgements }))
  }

  private async writeDrillmasterPostMortem(projectDir: string, workItemId: string) {
    const events = await this.events(projectDir)
    const state = foldState(events)
    const item = state.workItems[workItemId]!
    const workflow = work.workflowOfWorkItem(state, item)
    let postMortem: work.PostMortemArgs
    try {
      const { answer } = await this.ports.reviewer.review({
        kind: POST_MORTEM_REVIEW_KIND,
        prompt: buildPostMortemPrompt(item, workflow, events),
        minTimeoutMs: POST_MORTEM_TIMEOUT_MS,
      })
      postMortem = readPostMortemAnswer(answer, workflow, TOOL_NAMES)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      postMortem = { keep: [], change: [{ refs: [], text: `Drillmaster could not write its post mortem: ${reason}` }], experiment_reflections: [] }
    }
    await this.withProjectLock(projectDir, async (projectId, project) => {
      const currentItem = foldState(await this.ports.store.read(projectId)).workItems[workItemId]
      if (currentItem?.post_mortems.includes('drillmaster')) return
      await this.appendEvent(project, { type: 'post_mortem_written', work_item_id: workItemId, author: 'drillmaster', ...postMortem })
    })
  }

  private async runRetrospective(projectDir: string) {
    // Drillmaster's own post mortems and the friction judgements are made in the background; the retrospective needs them.
    await this.idle()
    const delivered = Object.values((await this.state(projectDir)).workItems).filter((item) => item.status === 'delivered')
    for (const item of delivered) await this.judgeFriction(projectDir, item.work_item_id)
    const events = await this.events(projectDir)
    const state = foldState(events)
    if (!state.workflow) throw new UserError(NO_WORKFLOW_YET)
    const reviewedItems = deliveredSinceLastRetro(state, events)
    const { answer } = await this.ports.reviewer
      .review({ kind: RETRO_REVIEW_KIND, prompt: buildRetroPrompt(state, events, TOOLS), minTimeoutMs: RETROSPECTIVE_TIMEOUT_MS })
      .catch((error: unknown) => {
        throw new UserError(`Drillmaster could not carry out the retrospective: ${error instanceof Error ? error.message : String(error)}`)
      })
    const retroResult = readRetroAnswer(state.workflow, answer, TOOL_NAMES)
    return this.withProjectLock(projectDir, async (projectId, project) => {
      const storedEvent = await this.appendEvent(project, {
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
    return this.withProjectLock(projectDir, async (projectId, project) => {
      const events = await this.ports.store.read(projectId)
      const state = foldState(events)
      const retro = state.latestRetroId ? state.retros[state.latestRetroId] : undefined
      if (!retro) throw new UserError('There is no workflow retrospective yet. Run one first.')
      if (onlyProposalId !== undefined) refuseUnapprovedProposal(retro, onlyProposalId)
      const toApply = onlyProposalId !== undefined ? [onlyProposalId] : retro.approved.filter((proposalId) => !retro.applied.includes(proposalId))
      if (toApply.length === 0) throw new UserError('Owner has approved no proposal that is still to apply. Ask Owner.', 403)

      let workflow = state.workflow!
      const applied: { proposal: number; workflow_version: string; level: string; change: string; experiment: unknown }[] = []
      const appliedIds = [...retro.applied]
      for (const proposalId of [...toApply].sort((a, b) => a - b)) {
        const proposal = retro.proposals.find((candidate) => candidate.id === proposalId)!
        const unappliedDependencies = (proposal.depends_on ?? []).filter((dependencyId) => !appliedIds.includes(dependencyId))
        if (unappliedDependencies.length) {
          throw new UserError(`Proposal ${proposalId} builds on proposal ${unappliedDependencies.join(', ')}, which is not applied. Owner must approve ${unappliedDependencies.length > 1 ? 'those' : 'it'} too.`, 409)
        }
        const changed = applyProposal(workflow, proposal, measureDeliveredItems(events), this.ports.clock.now().slice(0, 10))
        await this.pushWorkflowFirst(project, workflow, changed.workflow, `workflow ${changed.workflow.version}: ${proposal.change}`, applied.length)
        await this.appendEvent(project, { type: 'workflow_changed', workflow: changed.workflow, reason: proposal.change, level: changed.level, retro_id: retro.retro_id, proposal: proposalId })
        const openedExperiment = changed.workflow.experiments.find((experiment) => !workflow.experiments.some((earlier) => earlier.id === experiment.id))
        applied.push({ proposal: proposalId, workflow_version: changed.workflow.version, level: changed.level, change: proposal.change, experiment: openedExperiment ?? null })
        appliedIds.push(proposalId)
        workflow = changed.workflow
      }
      const openItems = Object.values(state.workItems).filter((item) => item.status === 'active').map((item) => item.work_item_id)
      return {
        applied,
        workflow_version: workflow.version,
        ...(openItems.length ? { note: `Open work items (${openItems.join(', ')}) stay on their workflow version; each moves to ${workflow.version} at the next step that allows an update.` } : {}),
      }
    })
  }

  /** A workflow change applies only once main of the Drillmaster repository has it. */
  private async pushWorkflowFirst(project: ProjectRef, current: WorkflowDocument, next: WorkflowDocument, message: string, appliedSoFar: number) {
    const publisher = this.publisherFor(project)
    if (!publisher) return
    await this.inRepositoryChain(project, () => publisher.pushWorkflow(current, next, message)).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      const applied = appliedSoFar ? ` The ${appliedSoFar} change${appliedSoFar > 1 ? 's' : ''} before it applied.` : ''
      throw new UserError(`The Drillmaster repository didn't take workflow ${next.version}, so it doesn't apply: ${reason}.${applied} Run the retrospective again.`, 409)
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

    return this.withProjectLock(projectDir, async (projectId, project) => {
      const currentItem = foldState(await this.ports.store.read(projectId)).workItems[item.work_item_id]
      const stillPending =
        currentItem?.pending_gate?.gate === 'drillmaster' && currentItem.pending_gate.stage === submission.stage && currentItem.pending_gate.step === submission.step
      if (!stillPending) return { verdict: 'superseded', note: 'This gate was decided while Drillmaster was judging it. Check work_status.' }
      const gatePosition = { work_item_id: item.work_item_id, ...work.atStep(workflow, submission.stage, submission.step) }
      if ('error' in judgement) {
        await this.appendEvent(project, { type: 'review_failed', ...gatePosition, error: judgement.error })
        return {
          verdict: 'pending',
          gate: 'drillmaster',
          ...gatePosition,
          note: `Drillmaster could not judge this gate (${judgement.error}). Hand the gate in again, or report the impediment.`,
        }
      }
      for (const inputAnswer of judgement.inputs) {
        await this.appendEvent(project, work.inputSetEvent(workflow, item.work_item_id, submission, { ...inputAnswer, by: 'drillmaster' }))
      }
      const { verdict } = judgement
      await this.appendEvent(project, { type: 'gate_verdict', ...gatePosition, by: 'drillmaster', ...verdict })
      const afterVerdict = foldState(await this.ports.store.read(projectId))
      const moved = verdict.accepted ? work.moveOn(afterVerdict, afterVerdict.workItems[item.work_item_id]!, workflow, verdict, { doneNow: [gatePosition.step_guid!] }) : undefined
      for (const movedEvent of moved?.events ?? []) await this.appendEvent(project, movedEvent)
      return {
        verdict: verdict.accepted ? 'accepted' : 'rejected',
        by: 'drillmaster',
        rule: verdict.rule,
        why: verdict.why,
        stage: submission.stage,
        step: submission.step,
        ...(moved ? work.describeMove(moved) : { next: verdict.next, done: verdict.done, session_done: false }),
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
      description: item.description,
      inputs: item.inputs,
      ...waitingForInputsOf(work.workflowOfWorkItem(state, item), item),
      passed_steps: stepNamesOf(work.workflowOfWorkItem(state, item), item.passed_step_guids),
      skipped_steps: stepNamesOf(work.workflowOfWorkItem(state, item), item.skipped_step_guids),
      pending_skip: item.pending_skip,
      last_update: item.last_update,
      session_stages: work.sessionStagesOf(work.workflowOfWorkItem(state, item), item),
    }
    const verdicts = events.filter((event) => event.type === 'gate_verdict' && event.work_item_id === item.work_item_id)
    status.last_verdict = verdicts.at(-1) ?? null
    const ownerQuestions = pendingOwnerQuestions(state).filter((question) => !('work_item_id' in question) || question.work_item_id === item.work_item_id)
    if (ownerQuestions.length) status.ask_owner = askUserQuestionInput(ownerQuestions)
    if (args.last !== undefined) status.last_reports = workReportsOf(events, item.work_item_id).slice(-args.last)
    if (args.stage !== undefined || args.step !== undefined) {
      const atStep = args.step !== undefined ? stepPosition(parseRef(args.step, 'step').name) ?? {} : { stage: Number(parseRef(args.stage!, 'stage').name) }
      status.captured = {
        reports: workReportsOf(events, item.work_item_id, atStep),
        traces: workTracesOf(events, item.work_item_id, atStep).map(({ raw: _raw, ...trace }) => trace),
      }
    }
    return status
  }
}

const stageGuidsOf = (workflow: WorkflowDocument, stageRefs: readonly string[]) => stageRefs.map((stageRef) => resolveRef(workflow, stageRef, { impliedKind: 'stage' }).guid!)
const namesOfStages = (workflow: WorkflowDocument, guids: readonly string[]) =>
  workflow.stages.filter((stage) => guids.includes(stage.guid)).map((stage) => `stage ${stage.n} "${stage.name}"`).join(', ')

const stepNamesOf = (workflow: WorkflowDocument, guids: readonly string[]) => guids.map((guid) => refOfGuid(workflow, guid)?.name ?? guid)

function waitingForInputsOf(workflow: WorkflowDocument, item: { stage: number | null; step: number | null; status: string; inputs: Record<string, { value: string }> }) {
  if (item.status !== 'active' || item.stage === null || item.step === null) return {}
  const applicability = work.applicabilityOf(workflow, item.stage, item.step, Object.fromEntries(Object.entries(item.inputs).map(([name, input]) => [name, input.value])))
  return applicability.applies === 'unknown' ? { waiting_for_inputs: applicability.missing } : {}
}

function stepOfRef(workflow: WorkflowDocument, stepRef: string) {
  return stepPosition(resolveRef(workflow, stepRef, { impliedKind: 'step' }).name)!
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
      retro.declined.includes(proposalId) ? `Owner declined proposal ${proposalId}.` : `Owner has not approved proposal ${proposalId}. Owner approves it in AskUserQuestion: ask Owner.`,
      403,
    )
  }
}
