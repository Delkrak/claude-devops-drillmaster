import { parsePipeline, runPipeline } from './logPipeline.js'
import type { WorkflowDocument } from './workflow.js'

/** The tools whose output a tool capture reads: Agent's shell commands. */
const SHELL_TOOLS = /^(Bash|PowerShell)$/
const MAX_KEPT_ENTRIES = 50
const MAX_KEPT_LINE_LENGTH = 300
/** Claude Code shortens a command's output around this length before the hook sees it. */
const OUTPUT_LENGTH_CLAUDE_CODE_MAY_SHORTEN = 25_000

export interface CapturedOutput {
  name: string
  lines: string[]
  fields: Record<string, string>[]
}

export interface ToolCaptureResult {
  captures: CapturedOutput[]
  /** Rules whose command matched, but whose pipeline kept nothing. */
  foundNothing: string[]
  mayBeShortened: boolean
}

const capLine = (line: string) => (line.length > MAX_KEPT_LINE_LENGTH ? `${line.slice(0, MAX_KEPT_LINE_LENGTH)}...` : line)

/**
 * What the workflow's tool captures keep of a shell command's output, with secrets removed
 * by redact. Undefined when no rule's command matches, so the trace keeps its last lines.
 */
export function captureToolOutput(workflow: WorkflowDocument | undefined, toolName: string | undefined, toolInput: unknown, output: string | undefined, redact: (text: string) => string): ToolCaptureResult | undefined {
  if (!workflow || !toolName || !SHELL_TOOLS.test(toolName) || output === undefined) return undefined
  const command = toolInput && typeof toolInput === 'object' ? (toolInput as { command?: unknown }).command : undefined
  if (typeof command !== 'string') return undefined
  const rules = workflow.tool_captures.filter((rule) => new RegExp(rule.command).test(command))
  if (rules.length === 0) return undefined
  const result: ToolCaptureResult = { captures: [], foundNothing: [], mayBeShortened: output.length >= OUTPUT_LENGTH_CLAUDE_CODE_MAY_SHORTEN }
  for (const rule of rules) {
    const entries = runPipeline(parsePipeline(rule.keep), output).slice(0, MAX_KEPT_ENTRIES)
    if (entries.length === 0) {
      result.foundNothing.push(rule.name)
      continue
    }
    result.captures.push({
      name: rule.name,
      lines: entries.map((entry) => redact(capLine(entry.line))),
      fields: entries.filter((entry) => Object.keys(entry.fields).length > 0).map((entry) => Object.fromEntries(Object.entries(entry.fields).map(([field, value]) => [field, redact(capLine(value))]))),
    })
  }
  return result
}
