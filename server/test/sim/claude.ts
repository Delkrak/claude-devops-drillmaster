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
  const claudeArgs = ['-p', '--output-format', 'json', ...(resume ? ['--resume', resume] : []), ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(env.DRILLMASTER_CLAUDE ?? 'claude', claudeArgs, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`claude turn timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      try {
        const claudeOutput = JSON.parse(stdout) as { session_id: string; result?: string; total_cost_usd?: number; is_error?: boolean }
        resolve({
          session_id: claudeOutput.session_id,
          result: claudeOutput.result ?? '',
          cost_usd: claudeOutput.total_cost_usd ?? 0,
          is_error: claudeOutput.is_error === true,
        })
      } catch {
        reject(new Error(`claude exited ${exitCode}: ${stderr.slice(-500) || stdout.slice(-500)}`))
      }
    })
    child.stdin.end(prompt)
  })
}
