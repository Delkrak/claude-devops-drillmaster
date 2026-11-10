import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { defaultFolderOf } from '../adapters/projects.js'
import { NOT_A_PROJECT, TOOLS, type ToolDefinition, type ToolResult } from '../app.js'
import { requestJson } from '../client.js'
import { projectToServe } from '../projectLocator.js'
import { findOrStartProjectServer } from '../projectServer.js'
import { VERSION } from '../version.js'

const errorResult = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** The Drillmaster repository a setup call names, so its project can be served before .drillmaster exists. */
function setupPlaceOf(projectDir: string, toolName: string, toolArgs: Record<string, unknown>) {
  if (toolName !== 'workflow_retrospective' || toolArgs.action !== 'setup' || typeof toolArgs.drillmaster_repository !== 'string') return undefined
  return { url: toolArgs.drillmaster_repository, folder: typeof toolArgs.folder === 'string' ? toolArgs.folder : defaultFolderOf(projectDir) }
}

/**
 * Claude Code's MCP server for one work folder. It forwards to the server of the folder's project,
 * which runs at the version the project pins; in a folder that isn't a project yet, only setup works.
 */
export async function runShim(env: NodeJS.ProcessEnv = process.env) {
  const projectDir = env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const serverUrlByProject = new Map<string, string>()
  const serverUrlOf = async (project: NonNullable<ReturnType<typeof projectToServe>>) => {
    const known = serverUrlByProject.get(project.key)
    if (known) return known
    const url = await findOrStartProjectServer(project, env)
    serverUrlByProject.set(project.key, url)
    return url
  }

  const mcp = new Server({ name: 'drillmaster', version: VERSION }, { capabilities: { tools: {} } })

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    const project = projectToServe(projectDir)
    if (!project) return { tools: TOOLS }
    const { tools } = await requestJson<{ tools: ToolDefinition[] }>(await serverUrlOf(project), 'GET', '/tools')
    return { tools }
  })

  mcp.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const toolArgs = request.params.arguments ?? {}
    const project = projectToServe(projectDir, setupPlaceOf(projectDir, request.params.name, toolArgs))
    if (!project) return errorResult(NOT_A_PROJECT)
    try {
      // Claude Code shows the model structuredContent instead of the text when both are there, and
      // the text is the rendering Agent should read.
      const { structuredContent: _structured, ...result } = await requestJson<ToolResult & CallToolResult>(await serverUrlOf(project), 'POST', '/tools/call', {
        project: projectDir,
        name: request.params.name,
        arguments: toolArgs,
      })
      return result
    } catch (error) {
      // The server may have stopped, for example after `drillmaster upgrade`: find or start it again on the next call.
      serverUrlByProject.delete(project.key)
      return errorResult(`Drillmaster server error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  await mcp.connect(new StdioServerTransport())
}
