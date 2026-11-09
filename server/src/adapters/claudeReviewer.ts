// The production reviewer: a headless `claude -p` run, so Drillmaster needs no API key of its own.
// It runs with no tools, no MCP servers and no session persistence, in a neutral directory, so the
// plugin's own hooks never trace it into the project it judges.

import { spawn } from 'node:child_process'
import os from 'node:os'
import type { Reviewer, ReviewRequest } from '../ports.js'

export interface ClaudeReviewerOptions {
  /** The claude executable, or a stand-in in tests. */
  command?: string
  /** Extra arguments before the reviewer's own, e.g. a script path for a stand-in. */
  prefixArgs?: string[]
  model?: string
  /** Per attempt. */
  timeoutMs?: number
  /** A first `claude -p` next to a busy session can stall once; a second attempt usually answers. */
  attempts?: number
}

export class ClaudeReviewer implements Reviewer {
  constructor(private readonly options: ClaudeReviewerOptions = {}) {}

  async review(request: ReviewRequest) {
    const attempts = this.options.attempts ?? 2
    const errors: string[] = []
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.once(request)
      } catch (error) {
        errors.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(errors.join(' | '))
  }

  private once(request: ReviewRequest) {
    const { command = 'claude', prefixArgs = [], model } = this.options
    const timeoutMs = Math.max(this.options.timeoutMs ?? 90_000, request.timeoutMs ?? 0)
    const args = [
      ...prefixArgs,
      '-p',
      '--output-format',
      'json',
      '--tools',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--disable-slash-commands',
      ...(model ? ['--model', model] : []),
    ]
    return new Promise<{ answer: unknown }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: os.tmpdir(), windowsHide: true, env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir() } })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        const tail = stderr.trim().slice(-300)
        reject(new Error(`The reviewer did not answer within ${timeoutMs / 1000}s.${tail ? ` stderr: ${tail}` : ''}`))
      }, timeoutMs)
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`Could not run the reviewer (${command}): ${error.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          const out = JSON.parse(stdout) as { result?: unknown; is_error?: boolean }
          if (code !== 0 || out.is_error) throw new Error(String(out.result ?? stderr ?? `exit ${code}`))
          resolve({ answer: out.result })
        } catch (error) {
          reject(new Error(`The reviewer failed (exit ${code}): ${error instanceof Error ? error.message : stderr}`.slice(0, 500)))
        }
      })
      child.stdin.end(`${request.prompt}`)
    })
  }
}
