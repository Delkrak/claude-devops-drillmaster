// The claude -p adapter against a stand-in executable that behaves like `claude -p --output-format json`.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClaudeReviewer } from '../../src/adapters/claudeReviewer.js'
import { tempDir } from '../helpers.js'

let dir: Awaited<ReturnType<typeof tempDir>>
let fake: string

beforeAll(async () => {
  dir = await tempDir('fake-claude')
  fake = path.join(dir.dir, 'fake-claude.mjs')
  // Echoes its stdin prompt and arguments back as the result; "FAIL" in the prompt fails like claude.
  await writeFile(
    fake,
    `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  if (input.includes('FAIL')) { console.log(JSON.stringify({ is_error: true, result: 'boom' })); process.exitCode = 1; return }
  if (input.includes('SLOW')) { setTimeout(() => {}, 60000); return }
  // STALL_ONCE: stalls on the first call only, tracked in a marker file next to this script.
  if (input.includes('STALL_ONCE')) {
    const fs = require('node:fs'), marker = process.argv[1] + '.stalled'
    if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); setTimeout(() => {}, 60000); return }
  }
  console.log(JSON.stringify({ is_error: false, result: JSON.stringify({ prompt: input, args: process.argv.slice(2) }) }))
})`,
  )
})
afterAll(() => dir.remove())

describe('ClaudeReviewer', () => {
  const reviewer = (timeoutMs = 10_000, attempts = 1) => new ClaudeReviewer({ command: process.execPath, prefixArgs: [fake], timeoutPerAttemptMs: timeoutMs, attempts })

  it('answers on the second attempt when the first stalls', async () => {
    const { answer } = await reviewer(800, 2).review({ kind: 'gate', prompt: 'STALL_ONCE' })
    expect(JSON.parse(answer as string).prompt).toBe('STALL_ONCE')
  })

  it('sends the prompt on stdin with no tools, no MCP and no session, and returns the result text', async () => {
    const { answer } = await reviewer().review({ kind: 'gate', prompt: 'judge this' })
    const echoed = JSON.parse(answer as string) as { prompt: string; args: string[] }
    expect(echoed.prompt).toBe('judge this')
    expect(echoed.args).toEqual(['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'])
  })

  it('fails when claude reports an error', async () => {
    await expect(reviewer().review({ kind: 'gate', prompt: 'FAIL' })).rejects.toThrow(/reviewer failed/)
  })

  it('fails on a timeout', async () => {
    await expect(reviewer(500).review({ kind: 'gate', prompt: 'SLOW' })).rejects.toThrow(/did not answer/)
  })

  it('fails when the executable is missing', async () => {
    await expect(new ClaudeReviewer({ command: path.join(dir.dir, 'nope') }).review({ kind: 'gate', prompt: 'x' })).rejects.toThrow(/Could not run/)
  })
})
