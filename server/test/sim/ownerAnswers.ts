import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

export interface AskedQuestion {
  question: string
  header?: string
  options: { label: string; description?: string; preview?: string }[]
}

export interface OwnerAnswers {
  answers: Record<string, string>
  annotations: Record<string, { notes: string }>
}

/** Owner's answer when no one decides otherwise: approve, or the first option. */
export const defaultAnswers = (questions: readonly AskedQuestion[]): OwnerAnswers => ({
  answers: Object.fromEntries(questions.map((question) => [question.question, (question.options.find((option) => option.label === 'Approve') ?? question.options[0])?.label ?? 'Approve'])),
  annotations: {},
})

/** The endpoint ownerMcp.mjs posts AskUserQuestion to, while Agent's turn waits for Owner. */
export function listenForOwnerQuestions(answer: (questions: AskedQuestion[]) => Promise<OwnerAnswers>) {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const { questions } = JSON.parse(body) as { questions: AskedQuestion[] }
    const answered = await answer(questions).catch(() => defaultAnswers(questions))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(answered))
  })
  return new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })),
  )
}

/** The MCP config that makes ownerMcp.mjs the run's permission host, answering at `answerUrl`. */
export const ownerMcpConfig = (answerUrl: string) => ({
  mcpServers: { owner: { command: 'node', args: [path.join(import.meta.dirname, 'ownerMcp.mjs')], env: { OWNER_ANSWER_URL: answerUrl } } },
})

export const OWNER_PERMISSION_TOOL = 'mcp__owner__answer'
