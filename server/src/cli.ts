#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { findOrStartServer, requestJson } from './client.js'
import { runDaemon } from './daemon/main.js'
import { runShim } from './mcp/shim.js'
import { VERSION } from './version.js'

const USAGE = `drillmaster ${VERSION}

Usage:
  drillmaster daemon                    Run the shared Drillmaster server.
  drillmaster mcp                       Run the stdio MCP server for Claude Code.
  drillmaster init --objective <text> --measure <name> [--measure <name>] [--store <git repo>] [--project <dir>]
                                        Create workflow_0 from Owner's objective.
  drillmaster inspect [--project <dir>] [--json]
                                        Show the project's events and folded state.
  drillmaster open                      Open the read-only viewer in the browser.

Environment:
  DRILLMASTER_HOME      Where the server keeps its port file and store (default ~/.drillmaster).
  DRILLMASTER_REVIEWER  claude (default) | scripted:<file> | none
  DRILLMASTER_CLAUDE    the claude executable for the reviewer (default: claude)
  DRILLMASTER_REVIEW_MODEL, DRILLMASTER_REVIEW_TIMEOUT (seconds per attempt, default 90),
  DRILLMASTER_REVIEW_ATTEMPTS (default 2)
  DRILLMASTER_CLOCK     system | fixed:<iso time>
  DRILLMASTER_RECORD    1 keeps raw hook payloads in the work traces, for test fixtures.
`

async function runCommand(argv: string[]) {
  const [command, ...commandArgs] = argv
  switch (command) {
    case 'daemon':
      return runDaemon()
    case 'mcp':
      return runShim()
    case 'init': {
      const { values } = parseArgs({
        args: commandArgs,
        options: {
          objective: { type: 'string' },
          measure: { type: 'string', multiple: true },
          store: { type: 'string' },
          project: { type: 'string' },
        },
      })
      if (!values.objective || !values.measure?.length) throw new Error(`init needs --objective and at least one --measure.\n\n${USAGE}`)
      const url = await findOrStartServer()
      const { workflow } = await requestJson<{ workflow: unknown }>(url, 'POST', '/projects/init', {
        project: values.project ?? process.cwd(),
        objective: { text: values.objective, measures: values.measure },
        ...(values.store ? { store: { repo: values.store } } : {}),
      })
      console.log(JSON.stringify(workflow, null, 2))
      return
    }
    case 'inspect': {
      const { values } = parseArgs({ args: commandArgs, options: { project: { type: 'string' }, json: { type: 'boolean' } } })
      const url = await findOrStartServer()
      const projectDir = values.project ?? process.cwd()
      const inspection = await requestJson<{ events: unknown[]; state: unknown }>(url, 'GET', `/state?idle=1&project=${encodeURIComponent(projectDir)}`)
      if (values.json) console.log(JSON.stringify(inspection, null, 2))
      else console.log(`${inspection.events.length} events\n\n${JSON.stringify(inspection.state, null, 2)}`)
      return
    }
    case 'open': {
      const url = await findOrStartServer()
      console.log(`Drillmaster viewer: ${url}/`)
      openInBrowser(`${url}/`)
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

function openInBrowser(url: string) {
  const [opener, openerArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(opener, openerArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

runCommand(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  // Not process.exit(): on Windows it can abort while fetch's sockets are still closing.
  process.exitCode = 1
})
