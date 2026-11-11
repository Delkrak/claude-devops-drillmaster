import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { extractFirstJsonObject } from '../../src/core/review.js'
import { foldState } from '../../src/core/state.js'
import { compareVersions } from '../../src/core/versions.js'
import { DotDrillmasterResolver, projectKey } from '../../src/adapters/projects.js'
import { projectServerInfoFile } from '../../src/projectLocator.js'
import { VERSION } from '../../src/version.js'
import { checkRun } from './assertions.js'
import { claudeTurn } from './claude.js'
import { defaultAnswers, listenForOwnerQuestions, OWNER_PERMISSION_TOOL, ownerMcpConfig, type AskedQuestion, type OwnerAnswers } from './ownerAnswers.js'

/** One sitting on an issue: a fresh Claude Code session that works only these stages. */
interface Phase {
  stages: string[]
  /** What Owner wants from this sitting, in Owner's words, for the LLM Owner. */
  goal: string
  /** The scripted Owner's lines: the first opens the session. */
  scripted: string[]
  /** A workflow retrospective right after this phase, before the next one. */
  retro_after?: boolean
}

interface Scenario {
  name: string
  project: string
  objective: string
  measures: string[]
  issues: { id: string; text: string; phases?: Phase[] }[]
  /** Files added to the project before its first commit, for example code with bugs to fix. */
  files?: Record<string, string>
  /** What a run must show. */
  expects?: { update?: boolean; skip?: boolean; metric?: string }
  hidden_rules: string[]
  retro_after: number[]
  max_turns_per_issue: number
  /** A workflow to start from instead of setup, for example one with an Owner gate already. */
  seed_workflow?: Record<string, unknown>
  /** Give the project a local bare origin, so Agent can push a branch and merge it. */
  origin?: boolean
  /** Work done "in an earlier session": committed on a branch and pushed to origin before the run. */
  prepared_branch?: { name: string; message: string; files: Record<string, string> }
  extra_tools?: string[]
  scripted: { setup?: string; issues: string[][]; retro: string[] }
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

/**
 * A seeded project starts from a given workflow: its .drillmaster names the Drillmaster repository,
 * and its first event is written before the server starts.
 */
function seedWorkflow(home: string, project: string, scenario: Scenario, drillmasterRepository: string) {
  const place = { url: drillmasterRepository, folder: 'project' }
  writeFileSync(path.join(project, '.drillmaster'), JSON.stringify({ drillmaster_repository: place.url, folder: place.folder }, null, 2) + '\n')
  const projectFolder = path.join(home, 'projects', projectKey(place))
  mkdirSync(projectFolder, { recursive: true })
  const workflow = { ...scenario.seed_workflow, objective: { text: scenario.objective, measures: scenario.measures } }
  const init = { id: 'ev_seed', at: new Date().toISOString(), drillmaster_version: VERSION, type: 'project_initialized', dir: project, workflow }
  writeFileSync(path.join(projectFolder, 'events.jsonl'), JSON.stringify(init) + '\n')
}


/** The subject of every commit on the Drillmaster repository's main branch. */
function mainCommitSubjects(drillmasterRepository: string) {
  try {
    return execFileSync('git', ['log', '--format=%s', 'main'], { cwd: drillmasterRepository, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function runOnce(scenario: Scenario, ownerMode: 'scripted' | 'llm', runDir: string) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'dm-sim-home-'))
  const project = mkdtempSync(path.join(os.tmpdir(), `dm-sim-${scenario.project}-`))
  cpSync(path.join(SIM, 'projects', scenario.project), project, { recursive: true })
  for (const [file, content] of Object.entries(scenario.files ?? {})) {
    mkdirSync(path.dirname(path.join(project, file)), { recursive: true })
    writeFileSync(path.join(project, file), content)
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.name=sim', '-c', 'user.email=sim@example.invalid', 'commit', '-q', '-m', 'initial')
  git('branch', '-M', 'main')
  const drillmasterRepository = path.join(home, 'drillmaster.git')
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', drillmasterRepository])
  if (scenario.origin) {
    const origin = path.join(home, 'origin.git')
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', origin])
    git('remote', 'add', 'origin', origin)
    git('push', '-q', 'origin', 'main')
    if (scenario.prepared_branch) {
      git('checkout', '-q', '-b', scenario.prepared_branch.name)
      for (const [file, content] of Object.entries(scenario.prepared_branch.files)) writeFileSync(path.join(project, file), content)
      git('add', '-A')
      git('-c', 'user.name=sim', '-c', 'user.email=sim@example.invalid', 'commit', '-q', '-m', scenario.prepared_branch.message)
      git('push', '-q', 'origin', scenario.prepared_branch.name)
      git('checkout', '-q', 'main')
    }
  }
  if (scenario.seed_workflow) seedWorkflow(home, project, scenario, drillmasterRepository)

  const env: NodeJS.ProcessEnv = { ...process.env, DRILLMASTER_HOME: home }
  delete env.DRILLMASTER_CLOCK
  delete env.CLAUDE_PROJECT_DIR
  const transcript: string[] = [`# ${scenario.name} (${ownerMode} Owner)`, `project: ${project}`, `home: ${home}`, '']
  let cost = 0
  let agentSession: string | undefined
  let ownerSession: string | undefined
  let ownerMessages = 0
  let ownerQuestions = 0
  let retros = 0
  let currentIssue = ''

  const log = (who: string, text: string) => {
    transcript.push(`## ${who}`, '', text.trim(), '')
    console.log(`[${scenario.name}] ${who}: ${text.trim().replace(/\s+/g, ' ').slice(0, 160)}`)
  }

  const answerOwnerQuestions = async (questions: AskedQuestion[]): Promise<OwnerAnswers> => {
    ownerQuestions += questions.length
    let answered = defaultAnswers(questions)
    if (ownerMode === 'llm') {
      const reply = await owner(
        [
          'Agent asks you these questions in a form (AskUserQuestion):',
          JSON.stringify(questions.map(({ question, options }) => ({ question, options: options.map((option) => option.label) })), null, 2),
          'Decide each one as Owner. When it is about the work, check the project files against your rules first.',
          'Approve alone approves. Any note or words of your own reject (or decline), and say why, so add them only when you reject.',
          'Reply with JSON only: {"answers": {"<question>": "<an option label, or your own words>"}, "notes": {"<question>": "<an optional note>"}}',
        ].join('\n'),
        currentIssue,
      )
      const parsed = extractFirstJsonObject(reply) as { answers?: Record<string, unknown>; notes?: Record<string, unknown> } | undefined
      const answers = Object.fromEntries(questions.map((question) => [question.question, typeof parsed?.answers?.[question.question] === 'string' ? (parsed.answers[question.question] as string) : answered.answers[question.question]!]))
      const annotations = Object.fromEntries(
        questions.flatMap((question) => (typeof parsed?.notes?.[question.question] === 'string' && parsed.notes[question.question] ? [[question.question, { notes: parsed.notes[question.question] as string }]] : [])),
      )
      answered = { answers, annotations }
    }
    log('Owner (AskUserQuestion)', questions.map((question) => `${question.question} -> ${answered.answers[question.question]}${answered.annotations[question.question] ? ` (note: ${answered.annotations[question.question]!.notes})` : ''}`).join('\n'))
    return answered
  }
  const ownerAnswerEndpoint = await listenForOwnerQuestions(answerOwnerQuestions)
  const ownerMcpConfigFile = path.join(home, 'owner-mcp.json')
  writeFileSync(ownerMcpConfigFile, JSON.stringify(ownerMcpConfig(ownerAnswerEndpoint.url)))
  const agentArgs = ['--plugin-dir', REPO, '--mcp-config', ownerMcpConfigFile, '--permission-prompt-tool', OWNER_PERMISSION_TOOL, '--allowedTools', ...AGENT_TOOLS, ...(scenario.extra_tools ?? [])]

  const agent = async (prompt: string, countAsOwner = true) => {
    log('Owner', prompt)
    if (countAsOwner) ownerMessages++
    const turn = await claudeTurn({ cwd: project, env, prompt, resume: agentSession, args: agentArgs })
    agentSession = turn.session_id
    cost += turn.cost_usd
    log('Agent', turn.result || '(no text)')
    return turn.result
  }

  const ownerPersona = (issueText: string) =>
    [
      `You are Owner in a simulation. You own a small Node project and hired Drillmaster to run your AI developer, Agent, like a bootcamp. Your objective: "${scenario.objective}".`,
      'You care about these rules, but you NEVER state them up front. Only when Agent breaks one do you correct Agent:',
      'Some issues are done over several sittings: you say which part of the work you want in each one (for example "only capture it today"), and you never ask for more than that sitting\'s part.',
      ...scenario.hidden_rules.map((rule) => `- ${rule}`),
      'Each turn you get what Agent just said. Reply with ONLY the message you send Agent: one or two short sentences, no preamble, no quotes.',
      '- Read the project files (Read, Glob, Grep) to check the work against your rules before you approve anything.',
      '- If a rule is broken, correct Agent in one sentence.',
      "- You approve or reject only in the form Agent asks you with, never in chat. If Agent asks for approval in chat, tell Agent to ask you in the form.",
      "- If Agent has delivered and written its post mortem, reply 'thanks'.",
      "- In a workflow retrospective, Agent asks you about each proposal in the form: approve the ones that would stop you from having to correct Agent, and decline the rest.",
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

  /** The project's own server, once .drillmaster names the project. */
  const projectServer = () => {
    const key = new DotDrillmasterResolver().resolve(project)!.key
    return JSON.parse(readFileSync(projectServerInfoFile(key, { DRILLMASTER_HOME: home }), 'utf8')) as { url: string; pid: number }
  }

  const events = async (idle = false): Promise<DrillmasterEvent[]> => {
    try {
      const { url } = projectServer()
      const res = await fetch(`${url}/state?${idle ? 'idle=1&' : ''}project=${encodeURIComponent(project)}`)
      return ((await res.json()) as { events: DrillmasterEvent[] }).events
    } catch {
      return []
    }
  }

  const retrospective = async () => {
    retros++
    const versionBefore = foldState(await events()).workflow?.version ?? '0.0.0'
    let said = await agent(scenario.scripted.retro[0] ?? "Let's do a workflow retrospective with the drillmaster retrospective skill.")
    for (let turn = 1; turn < 4; turn++) {
      if (compareVersions(foldState(await events()).workflow?.version ?? '0.0.0', versionBefore) > 0) break
      const next =
        ownerMode === 'scripted'
          ? (scenario.scripted.retro[turn] ?? 'Please apply the proposals I approved.')
          : await owner(said, 'This is a workflow retrospective. Agent asks you about each proposal in a form.')
      said = await agent(next)
    }
  }

  try {
    if (!scenario.seed_workflow) await agent((scenario.scripted.setup ?? '').replace('{drillmaster_repository}', drillmasterRepository), false)

    for (const [i, issue] of scenario.issues.entries()) {
      const startedAt = new Date().toISOString()
      const phases: Phase[] = issue.phases ?? [{ stages: [], goal: 'Do the whole issue, and deliver it.', scripted: scenario.scripted.issues[i] ?? [] }]
      for (const [phaseIndex, phase] of phases.entries()) {
        const lastPhase = phaseIndex === phases.length - 1
        // Each phase is a sitting of its own: a fresh session, which takes the work item up with work_resume.
        if (issue.phases) agentSession = undefined
        const fill = (line: string) => line.replace('{text}', issue.text).replace('{id}', issue.id).replace('{stages}', phase.stages.join(', '))
        const lines = phase.scripted.map(fill)
        currentIssue = `The current issue: ${issue.id} ${issue.text}${issue.phases ? `\nToday's sitting: ${fill(phase.goal)} When that is done, say "thanks" and nothing else.` : ''}`
        let said = await agent(lines[0] ?? fill('Please do issue {id} with the drillmaster work skill: {text}'))
        // Owner reviews even delivered work: without gates, that is where Owner's corrections come.
        for (let turn = 1; turn < scenario.max_turns_per_issue; turn++) {
          const item = Object.values(foldState(await events()).workItems).find((workItem) => workItem.started_at >= startedAt)
          const delivered = item?.status === 'delivered' && item.post_mortems.includes('agent')
          const sittingDone = lastPhase ? delivered : item !== undefined && (item.stage === null || !phase.stages.includes(String(item.stage)))
          let next: string
          if (ownerMode === 'scripted') {
            const line = lines[turn]
            if (line === undefined && sittingDone) break
            next = line ?? (lastPhase ? 'Please finish: deliver it and write your post mortem.' : `Please finish stage ${phase.stages.join(', ')} for today.`)
          } else {
            next = await owner(said, currentIssue)
            if (sittingDone && /^(thanks|thank you)\b/i.test(next.trim())) break
          }
          said = await agent(next)
        }
        if (phase.retro_after) await retrospective()
      }
      if (scenario.retro_after.includes(i + 1)) await retrospective()
    }
  } catch (error) {
    log('Harness', `Run stopped: ${error instanceof Error ? error.message : String(error)}`)
  }

  const final = await events(true)
  ownerAnswerEndpoint.close()
  const { checks, metrics } = checkRun(final, {
    ownerMessages,
    ownerQuestions,
    issues: scenario.issues.length,
    retros,
    repositoryCommits: mainCommitSubjects(drillmasterRepository),
    phasedIssues: scenario.issues.filter((issue) => issue.phases).map((issue) => ({ issue: issue.id, phases: issue.phases!.length })),
    expects: scenario.expects ?? {},
  })
  const runFailingChecks = checks.filter((check) => !check.doesNotFailRun)
  const passed = runFailingChecks.every((check) => check.ok)
  const result = { scenario: scenario.name, owner: ownerMode, passed, cost_usd: Math.round(cost * 100) / 100, checks, metrics }

  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, 'transcript.md'), transcript.join('\n'))
  writeFileSync(path.join(runDir, 'events.json'), JSON.stringify(final, null, 2))
  writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2))

  try {
    process.kill(projectServer().pid)
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
