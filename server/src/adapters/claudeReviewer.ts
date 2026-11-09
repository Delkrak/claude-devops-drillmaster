import { spawn } from 'node:child_process'
import os from 'node:os'
import type { Reviewer, ReviewRequest } from '../ports.js'

const DEFAULT_TIMEOUT_PER_ATTEMPT_MS = 90_000
const DEFAULT_ATTEMPTS = 2
const MAX_STDERR_IN_ERROR = 300
const MAX_ERROR_LENGTH = 500

export interface ClaudeReviewerOptions {
  command?: string
  prefixArgs?: string[]
  model?: string
  timeoutPerAttemptMs?: number
  attempts?: number
}

export class ClaudeReviewer implements Reviewer {
  constructor(private readonly options: ClaudeReviewerOptions = {}) {}

  async review(request: ReviewRequest) {
    const attempts = this.options.attempts ?? DEFAULT_ATTEMPTS
    const errors: string[] = []
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.runClaudeOnce(request)
      } catch (error) {
        errors.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(errors.join(' | '))
  }

  private runClaudeOnce(request: ReviewRequest) {
    const { command = 'claude', prefixArgs = [], model } = this.options
    const timeoutMs = Math.max(this.options.timeoutPerAttemptMs ?? DEFAULT_TIMEOUT_PER_ATTEMPT_MS, request.minTimeoutMs ?? 0)
    // No tools, no MCP servers and a neutral directory: the plugin's own hooks must never trace
    // the reviewer's session into the project it judges.
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
        const stderrTail = stderr.trim().slice(-MAX_STDERR_IN_ERROR)
        reject(new Error(`The reviewer did not answer within ${timeoutMs / 1000}s.${stderrTail ? ` stderr: ${stderrTail}` : ''}`))
      }, timeoutMs)
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`Could not run the reviewer (${command}): ${error.message}`))
      })
      child.on('close', (exitCode) => {
        clearTimeout(timer)
        try {
          const claudeOutput = JSON.parse(stdout) as { result?: unknown; is_error?: boolean }
          if (exitCode !== 0 || claudeOutput.is_error) throw new Error(String(claudeOutput.result ?? stderr ?? `exit ${exitCode}`))
          resolve({ answer: claudeOutput.result })
        } catch (error) {
          reject(new Error(`The reviewer failed (exit ${exitCode}): ${error instanceof Error ? error.message : stderr}`.slice(0, MAX_ERROR_LENGTH)))
        }
      })
      child.stdin.end(request.prompt)
    })
  }
}
