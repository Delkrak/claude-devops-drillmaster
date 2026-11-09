// The simulated Owner's permission host: Claude Code calls its `answer` tool for every permission
// prompt in a `claude -p` run. AskUserQuestion goes to the harness, which answers as Owner; any other
// tool not allowed up front is denied, as it would be without a permission host.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const answerUrl = process.env.OWNER_ANSWER_URL
const server = new Server({ name: 'owner', version: '0.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'answer',
      description: "Answers Claude Code's permission prompts as the simulated Owner.",
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } } },
    },
  ],
}))

const decision = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { tool_name: toolName, input = {} } = request.params.arguments ?? {}
  if (toolName !== 'AskUserQuestion') return decision({ behavior: 'deny', message: `${toolName} is not allowed in this simulation.` })
  try {
    const response = await fetch(answerUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questions: input.questions ?? [] }) })
    const { answers, annotations } = await response.json()
    return decision({ behavior: 'allow', updatedInput: { ...input, answers, annotations } })
  } catch (error) {
    return decision({ behavior: 'deny', message: `Owner could not be asked: ${error instanceof Error ? error.message : String(error)}` })
  }
})

await server.connect(new StdioServerTransport())
