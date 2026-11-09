// The Drillmaster application: everything the server can do, independent of HTTP or MCP. The
// daemon exposes it over REST, and the stdio shim forwards MCP tool calls to it.

import path from 'node:path'
import { z } from 'zod'
import type { DrillmasterEvent, NewEvent } from './core/events.js'
import { foldState, viewWorkflow, WorkflowQueryError, type ProjectState } from './core/state.js'
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

const WorkflowGetArgs = z
  .object({
    stage: z.number().int().positive().optional(),
    full: z.boolean().optional(),
    version: z.number().int().nonnegative().optional(),
  })
  .strict()

export const TOOLS: ToolDefinition[] = [
  {
    name: 'workflow_get',
    description:
      'Describes the workflow, which is the same for everyone in the project. With no arguments: Owner\'s objective and measures, the work stages, and the running workflow experiments. With `stage`: that work stage\'s work steps, each with its work gate, the full text of the work policy rules it references, and what Agent must report. With `full`: the whole workflow. With `version`: an earlier workflow version.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'integer', minimum: 1, description: 'The work stage number.' },
        full: { type: 'boolean', description: 'Return the whole workflow.' },
        version: { type: 'integer', minimum: 0, description: 'An earlier workflow version; 0 is the first.' },
      },
    },
  },
]

export class Drillmaster {
  constructor(private readonly ports: Ports) {}

  private async append(project: string, event: NewEvent): Promise<DrillmasterEvent> {
    const full = { ...event, id: this.ports.ids.next('ev'), at: this.ports.clock.now() } as DrillmasterEvent
    await this.ports.store.append(project, full)
    return full
  }

  async events(dir: string) {
    return this.ports.store.read(projectId(dir))
  }

  async state(dir: string): Promise<ProjectState> {
    return foldState(await this.events(dir))
  }

  /** Creates workflow_0 from Owner's objective. A project is initialized once. */
  async init(dir: string, objective: unknown) {
    const parsed = Objective.safeParse(objective)
    if (!parsed.success) throw new UserError(`Invalid objective: ${z.prettifyError(parsed.error)}`)
    const state = await this.state(dir)
    if (state.initialized) {
      throw new UserError('This project already has a workflow. It changes only at a workflow retrospective.', 409)
    }
    const workflow = workflowZero(parsed.data)
    await this.append(projectId(dir), { type: 'project_initialized', dir: path.resolve(dir), workflow })
    return workflow
  }

  tools() {
    return TOOLS
  }

  async callTool(dir: string, name: string, args: unknown): Promise<ToolResult> {
    try {
      switch (name) {
        case 'workflow_get': {
          const parsed = WorkflowGetArgs.safeParse(args ?? {})
          if (!parsed.success) throw new UserError(z.prettifyError(parsed.error))
          return ok(viewWorkflow(await this.state(dir), parsed.data))
        }
        default:
          throw new UserError(`Unknown tool: ${name}`, 404)
      }
    } catch (error) {
      if (error instanceof UserError || error instanceof WorkflowQueryError) {
        return { content: [{ type: 'text', text: error.message }], isError: true }
      }
      throw error
    }
  }
}

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
