import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDefinition, ToolResult } from '../app.js'
import { findOrStartServer, requestJson } from '../client.js'
import { VERSION } from '../version.js'

export async function runShim(env: NodeJS.ProcessEnv = process.env) {
  const projectDir = env.CLAUDE_PROJECT_DIR ?? process.cwd()
  let cachedServerUrl: string | undefined
  const serverUrl = async () => (cachedServerUrl ??= await findOrStartServer(env))

  const mcp = new Server({ name: 'drillmaster', version: VERSION }, { capabilities: { tools: {} } })

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await requestJson<{ tools: ToolDefinition[] }>(await serverUrl(), 'GET', '/tools')
    return { tools }
  })

  mcp.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      return await requestJson<ToolResult & CallToolResult>(await serverUrl(), 'POST', '/tools/call', {
        project: projectDir,
        name: request.params.name,
        arguments: request.params.arguments ?? {},
      })
    } catch (error) {
      // The server may have stopped: find or start it again on the next call.
      cachedServerUrl = undefined
      return {
        content: [{ type: 'text', text: `Drillmaster server error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  })

  await mcp.connect(new StdioServerTransport())
}
