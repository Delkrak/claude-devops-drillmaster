// `drillmaster mcp`: the stdio MCP server that Claude Code starts. It stores nothing: it finds or
// starts the shared Drillmaster server and forwards every tool call to it, with the project dir.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDefinition, ToolResult } from '../app.js'
import { ensureDaemon, request } from '../client.js'
import { VERSION } from '../version.js'

export async function runShim(env: NodeJS.ProcessEnv = process.env) {
  const project = env.CLAUDE_PROJECT_DIR ?? process.cwd()
  let url: string | undefined
  const server = async () => (url ??= await ensureDaemon(env))

  const mcp = new Server({ name: 'drillmaster', version: VERSION }, { capabilities: { tools: {} } })

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await request<{ tools: ToolDefinition[] }>(await server(), 'GET', '/tools')
    return { tools }
  })

  mcp.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    try {
      return await request<ToolResult & CallToolResult>(await server(), 'POST', '/tools/call', {
        project,
        name: req.params.name,
        arguments: req.params.arguments ?? {},
      })
    } catch (error) {
      url = undefined // The server may have stopped; find or start it again on the next call.
      return {
        content: [{ type: 'text', text: `Drillmaster server error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  })

  await mcp.connect(new StdioServerTransport())
}
