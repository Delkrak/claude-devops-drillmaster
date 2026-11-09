#!/usr/bin/env node
// drillmaster daemon | mcp | init | inspect

import { parseArgs } from 'node:util'
import { ensureDaemon, request } from './client.js'
import { runDaemon } from './daemon/main.js'
import { runShim } from './mcp/shim.js'
import { VERSION } from './version.js'

const USAGE = `drillmaster ${VERSION}

Usage:
  drillmaster daemon                    Run the shared Drillmaster server.
  drillmaster mcp                       Run the stdio MCP server for Claude Code.
  drillmaster init --objective <text> --measure <name> [--measure <name>] [--project <dir>]
                                        Create workflow_0 from Owner's objective.
  drillmaster inspect [--project <dir>] [--json]
                                        Show the project's events and folded state.

Environment:
  DRILLMASTER_HOME      Where the server keeps its port file and store (default ~/.drillmaster).
  DRILLMASTER_REVIEWER  none | scripted:<file>
  DRILLMASTER_CLOCK     system | fixed:<iso time>
`

async function main(argv: string[]) {
  const [command, ...rest] = argv
  switch (command) {
    case 'daemon':
      return runDaemon()
    case 'mcp':
      return runShim()
    case 'init': {
      const { values } = parseArgs({
        args: rest,
        options: {
          objective: { type: 'string' },
          measure: { type: 'string', multiple: true },
          project: { type: 'string' },
        },
      })
      if (!values.objective || !values.measure?.length) throw new Error(`init needs --objective and at least one --measure.\n\n${USAGE}`)
      const url = await ensureDaemon()
      const { workflow } = await request<{ workflow: unknown }>(url, 'POST', '/projects/init', {
        project: values.project ?? process.cwd(),
        objective: { text: values.objective, measures: values.measure },
      })
      console.log(JSON.stringify(workflow, null, 2))
      return
    }
    case 'inspect': {
      const { values } = parseArgs({ args: rest, options: { project: { type: 'string' }, json: { type: 'boolean' } } })
      const url = await ensureDaemon()
      const project = values.project ?? process.cwd()
      const result = await request<{ events: unknown[]; state: unknown }>(url, 'GET', `/state?project=${encodeURIComponent(project)}`)
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(`${result.events.length} events\n\n${JSON.stringify(result.state, null, 2)}`)
      return
    }
    case undefined:
    case '--help':
    case 'help':
      console.log(USAGE)
      return
    case '--version':
      console.log(VERSION)
      return
    default:
      throw new Error(`Unknown command: ${command}\n\n${USAGE}`)
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  // Not process.exit(): on Windows it can abort while fetch's sockets are still closing.
  process.exitCode = 1
})
