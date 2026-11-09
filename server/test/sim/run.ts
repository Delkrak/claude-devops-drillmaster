import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { foldState } from '../../src/core/state.js'
import { checkRun } from './assertions.js'
import { claudeTurn } from './claude.js'

interface Scenario {
  name: string
  project: string
  objective: string
  measures: string[]
  issues: { id: string; text: string }[]
  hidden_rules: string[]
  retro_after: number[]
  max_turns_per_issue: number
  scripted: { setup: string; issues: string[][]; retro: string[] }
}

const SIM = import.meta.dirname
const REPO = path.resolve(SIM, '../../..')
const AGENT_TOOLS = [
  'mcp__plugin_devops-drillmaster_drillmaster',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Skill',
  'Bash(npm test:*)',
  'Bash(npm run test:*)',
  'Bash(node:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
]

async function runOnce(scenario: Scenario, ownerMode: 'scripted' | 'llm', runDir: string) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'dm-sim-home-'))
  const project = mkdtempSync(path.join(os.tmpdir(), `dm-sim-${scenario.project}-`))
  cpSync(path.join(SIM, 'projects', scenario.project), project, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.name=sim', '-c', 'user.email=sim@example.invalid', 'commit', '-q', '-m', 'initial')

  const env: NodeJS.ProcessEnv = { ...process.env, DRILLMASTER_HOME: home }
  delete env.DRILLMASTER_CLOCK
  delete env.CLAUDE_PROJECT_DIR
  const transcript: string[] = [`# ${scenario.name} (${ownerMode} Owner)`, `project: ${project}`, `home: ${home}`, '']
  let cost = 0
  let agentSession: string | undefined
  let ownerSession: string | undefined
  let ownerMessages = 0
  let retros = 0

  const log = (who: string, text: string) => {
    transcript.push(`## ${who}`, '', text.trim(), '')
    console.log(`[${scenario.name}] ${who}: ${text.trim().replace(/\s+/g, ' ').slice(0, 160)}`)
  }

  const agent = async (prompt: string, countAsOwner = true) => {
    log('Owner', prompt)
    if (countAsOwner) ownerMessages++
    const turn = await claudeTurn({ cwd: project, env, prompt, resume: agentSession, args: ['--plugin-dir', REPO, '--allowedTools', ...AGENT_TOOLS] })
    agentSession = turn.session_id
    cost += turn.cost_usd
    log('Agent', turn.result || '(no text)')
    return turn.result
  }

  const ownerPersona = (issueText: string) =>
    [
      `You are Owner in a simulation. You own a small Node project and hired Drillmaster to run your AI developer, Agent, like a bootcamp. Your objective: "${scenario.objective}".`,
      'You care about these rules, but you NEVER state them up front. Only when Agent breaks one do you correct Agent:',
      ...scenario.hidden_rules.map((rule) => `- ${rule}`),
      'Each turn you get what Agent just said. Reply with ONLY the message you send Agent: one or two short sentences, no preamble, no quotes.',
      '- Read the project files (Read, Glob, Grep) to check the work against your rules before you approve anything.',
      '- If a rule is broken, correct Agent in one sentence.',
      "- If Agent asks for your approval and every rule is met, approve in plain words, like 'looks good'.",
      "- If Agent has delivered and written its post mortem, reply 'thanks'.",
      "- In a workflow retrospective, approve by number the proposals that would stop you from having to correct Agent (e.g. 'approve 1 and 2'), and decline the rest.",
      `The current issue: ${issueText}`,
    ].join('\n')

  const owner = async (agentSaid: string, context: string) => {
    const prompt = ownerSession ? `${context}\nAgent said:\n${agentSaid}\n\nYour reply to Agent:` : `${ownerPersona(context)}\n\nAgent said:\n${agentSaid}\n\nYour reply to Agent:`
    const turn = await claudeTurn({
      cwd: project,
      env: { ...env, DRILLMASTER_HOME: path.join(home, 'owner-unused') },
      prompt,
      resume: ownerSession,
      args: ['--tools', 'Read', 'Glob', 'Grep', '--allowedTools', 'Read', 'Glob', 'Grep', '--strict-mcp-config'],
    })
    ownerSession = turn.session_id
    cost += turn.cost_usd
    return turn.result.trim().replace(/^["']|["']$/g, '') || 'Please continue.'
  }

  const events = async (idle = false): Promise<DrillmasterEvent[]> => {
    try {
      const { url } = JSON.parse(readFileSync(path.join(home, 'daemon.json'), 'utf8')) as { url: string }
      const res = await fetch(`${url}/state?${idle ? 'idle=1&' : ''}project=${encodeURIComponent(project)}`)
      return ((await res.json()) as { events: DrillmasterEvent[] }).events
    } catch {
      return []
    }
  }

  try {
    await agent(scenario.scripted.setup, false)

    for (const [i, issue] of scenario.issues.entries()) {
      const lines = scenario.scripted.issues[i] ?? []
      const opening = (lines[0] ?? 'Please do issue {id} with the drillmaster work skill: {text}').replace('{text}', issue.text).replace('{id}', issue.id)
      const startedAt = new Date().toISOString()
      let said = await agent(opening)
      // Owner reviews even delivered work: without gates, that is where Owner's corrections come.
      for (let turn = 1; turn < scenario.max_turns_per_issue; turn++) {
        const state = foldState(await events())
        const issueItems = Object.values(state.workItems).filter((workItem) => workItem.started_at >= startedAt)
        const done = issueItems.some((workItem) => workItem.status === 'delivered' && workItem.post_mortems.includes('agent'))
        let next: string
        if (ownerMode === 'scripted') {
          const line = lines[turn]
          if (line === undefined && done) break
          next = line ?? 'Please finish: deliver it and write your post mortem.'
        } else {
          next = await owner(said, `The current issue: ${issue.id} ${issue.text}`)
          if (done && /^(thanks|thank you)\b/i.test(next.trim())) break
        }
        said = await agent(next)
      }

      if (scenario.retro_after.includes(i + 1)) {
        retros++
        const versionBefore = foldState(await events()).workflow?.version ?? 0
        said = await agent(scenario.scripted.retro[0] ?? "Let's do a workflow retrospective with the drillmaster retrospective skill.")
        for (let turn = 1; turn < 4; turn++) {
          if ((foldState(await events()).workflow?.version ?? 0) > versionBefore) break
          const next =
            ownerMode === 'scripted'
              ? (scenario.scripted.retro[turn] ?? 'Please apply the proposals I approved.')
              : await owner(said, 'This is a workflow retrospective. Decide on the proposals by number.')
          said = await agent(next)
        }
      }
    }
  } catch (error) {
    log('Harness', `Run stopped: ${error instanceof Error ? error.message : String(error)}`)
  }

  const final = await events(true)
  const { checks, metrics } = checkRun(final, { ownerMessages, issues: scenario.issues.length, retros })
  const runFailingChecks = checks.filter((check) => !check.doesNotFailRun)
  const passed = runFailingChecks.every((check) => check.ok)
  const result = { scenario: scenario.name, owner: ownerMode, passed, cost_usd: Math.round(cost * 100) / 100, checks, metrics }

  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, 'transcript.md'), transcript.join('\n'))
  writeFileSync(path.join(runDir, 'events.json'), JSON.stringify(final, null, 2))
  writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2))

  try {
    const { pid } = JSON.parse(readFileSync(path.join(home, 'daemon.json'), 'utf8')) as { pid: number }
    process.kill(pid)
  } catch {
    // No server was started.
  }
  try {
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  } catch {
    // Windows may still hold a file for a moment; temp dirs are cleaned by the OS.
  }
  return result
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { owner: { type: 'string', default: 'scripted' }, runs: { type: 'string', default: '1' } },
  })
  if (positionals.length === 0) throw new Error('Usage: npm run sim -- <scenario.json>... [--owner scripted|llm] [--runs n]')
  const ownerMode = values.owner === 'llm' ? 'llm' : 'scripted'
  const summary: { scenario: string; run: number; passed: boolean; cost_usd: number; failed: string[]; informational: string[] }[] = []
  for (const file of positionals) {
    const scenario = JSON.parse(readFileSync(path.resolve(file), 'utf8')) as Scenario
    for (let run = 1; run <= Number(values.runs); run++) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const runDir = path.join(SIM, 'runs', `${stamp}-${scenario.name}-${ownerMode}-${run}`)
      const result = await runOnce(scenario, ownerMode, runDir)
      summary.push({
        scenario: scenario.name,
        run,
        passed: result.passed,
        cost_usd: result.cost_usd,
        failed: result.checks.filter((check) => !check.ok && !check.doesNotFailRun).map((check) => `${check.name} (${check.detail})`),
        informational: result.checks.filter((check) => check.doesNotFailRun).map((check) => `${check.ok ? 'ok' : 'no'}: ${check.name} (${check.detail})`),
      })
      console.log(`\n=== ${scenario.name} run ${run}: ${result.passed ? 'PASSED' : 'FAILED'} ($${result.cost_usd}) -> ${runDir}`)
      for (const check of result.checks) console.log(`  ${check.ok ? 'ok ' : check.doesNotFailRun ? '~  ' : 'FAIL'} ${check.name}: ${check.detail}`)
    }
  }
  const passes = summary.filter((entry) => entry.passed).length
  console.log(`\n${passes}/${summary.length} runs passed.`)
  writeFileSync(path.join(SIM, 'runs', `summary-${Date.now()}.json`), JSON.stringify(summary, null, 2))
  process.exitCode = passes === summary.length ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
