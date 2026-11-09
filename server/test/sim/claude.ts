// Runs one turn of a headless Claude Code session: `claude -p`, resumed when a session id is given.

import { spawn } from 'node:child_process'

export interface Turn {
  session_id: string
  result: string
  cost_usd: number
  is_error: boolean
}

export interface TurnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  prompt: string
  resume?: string
  args?: string[]
  timeoutMs?: number
}

export function claudeTurn({ cwd, env, prompt, resume, args = [], timeoutMs = 900_000 }: TurnOptions): Promise<Turn> {
  const argv = ['-p', '--output-format', 'json', ...(resume ? ['--resume', resume] : []), ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(env.DRILLMASTER_CLAUDE ?? 'claude', argv, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`claude turn timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const out = JSON.parse(stdout) as { session_id: string; result?: string; total_cost_usd?: number; is_error?: boolean }
        resolve({ session_id: out.session_id, result: out.result ?? '', cost_usd: out.total_cost_usd ?? 0, is_error: out.is_error === true })
      } catch {
        reject(new Error(`claude exited ${code}: ${stderr.slice(-500) || stdout.slice(-500)}`))
      }
    })
    child.stdin.end(prompt)
  })
}
