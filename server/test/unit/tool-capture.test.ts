import { describe, expect, it } from 'vitest'
import type { DrillmasterEvent, WorkTrace } from '../../src/core/events.js'
import { handleHook } from '../../src/core/hooks.js'
import { applyWorkflowOps } from '../../src/core/retro.js'
import { foldState } from '../../src/core/state.js'
import { migrateWorkflow, WorkflowDocument } from '../../src/core/workflow.js'
import { WORKFLOW_3 } from '../helpers.js'

const TESTS_CAPTURE = { name: 'tests', command: 'npm (run )?test', keep: '|~ `^# (tests|pass|fail) ` | pattern `# <what> <count>`' }
const WITH_CAPTURE = migrateWorkflow({ ...WORKFLOW_3, tool_captures: [TESTS_CAPTURE] })
const at = '2026-11-09T10:00:00Z'
const events = [{ id: 'e0', at, type: 'project_initialized', dir: '/p', workflow: WITH_CAPTURE }] as DrillmasterEvent[]
const NODE_TEST = ['ok 1 - header', 'not ok 2 - quotes', '# tests 2', '# pass 1', '# fail 1', 'password=hunter2', ''].join('\n')

const traceOf = (tool: string, command: string, stdout: string) =>
  handleHook(foldState(events), 'PostToolUse', { session_id: 's1', tool_name: tool, tool_input: { command }, tool_response: { stdout, stderr: '' } }, false).events.find(
    (event): event is WorkTrace => event.type === 'work_trace',
  )!

describe('tool capture', () => {
  it("keeps what the workflow's rule yields instead of the last lines", () => {
    const trace = traceOf('Bash', 'npm test', NODE_TEST)
    expect(trace.captures).toEqual([
      {
        name: 'tests',
        lines: ['# tests 2', '# pass 1', '# fail 1'],
        fields: [
          { what: 'tests', count: '2' },
          { what: 'pass', count: '1' },
          { what: 'fail', count: '1' },
        ],
      },
    ])
    expect(trace.output).toBeUndefined()
    expect(traceOf('PowerShell', 'npm run test', NODE_TEST).captures).toHaveLength(1)
  })

  it('keeps the last lines of commands no rule matches, and when a rule finds nothing, says so', () => {
    const other = traceOf('Bash', 'git status', 'On branch main\nnothing to commit')
    expect(other).toMatchObject({ output: 'On branch main\nnothing to commit' })
    expect(other.captures).toBeUndefined()
    const changed = traceOf('Bash', 'npm test', 'TAP version 14\n✔ all 25 tests passed')
    expect(changed).toMatchObject({ capture_found_nothing: ['tests'], output: 'TAP version 14\n✔ all 25 tests passed' })
  })

  it('redacts what it keeps, and marks output Claude Code may have shortened', () => {
    const secrets = traceOf('Bash', 'npm test', NODE_TEST.replace('# pass 1', '# pass 1 password=hunter2'))
    expect(JSON.stringify(secrets.captures)).not.toContain('hunter2')
    expect(traceOf('Bash', 'npm test', `${'x'.repeat(26_000)}\n# tests 1`)).toMatchObject({ output_may_be_shortened: true })
  })
})

describe('tool captures in the workflow', () => {
  it('are added, changed and removed by a retrospective, as minor changes', () => {
    const added = applyWorkflowOps(WORKFLOW_3, [{ op: 'add_tool_capture', capture: TESTS_CAPTURE }], () => 'guid-capture')
    expect(added).toMatchObject({ version: '3.1.0', tool_captures: [{ guid: 'guid-capture', ...TESTS_CAPTURE }] })
    const changed = applyWorkflowOps(added, [{ op: 'change_tool_capture', capture: 'tests', keep: '|= "fail"' }])
    expect(changed.tool_captures[0]).toMatchObject({ guid: 'guid-capture', keep: '|= "fail"' })
    expect(applyWorkflowOps(changed, [{ op: 'remove_tool_capture', capture: 'capture tests' }]).tool_captures).toEqual([])
  })

  it('refuses a pipeline outside the subset, or a command that is no regular expression', () => {
    const problems = (capture: object) => WorkflowDocument.safeParse({ ...WORKFLOW_3, tool_captures: [{ guid: 'g', ...TESTS_CAPTURE, ...capture }] }).error?.issues.map((issue) => issue.message)
    expect(problems({ keep: '| unwrap duration' })?.[0]).toMatch(/^tool capture "tests": .*expected a parser, line_format, or a field filter/)
    expect(problems({ command: 'npm (test' })).toEqual(['tool capture "tests": its command npm (test is not a regular expression'])
  })
})

describe('a command that failed', () => {
  it('is traced as failed from PostToolUseFailure, and captured from its error', () => {
    const failing = handleHook(foldState(events), 'PostToolUseFailure', { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: `Exit code 1\n${NODE_TEST}` }, false).events.find(
      (event): event is WorkTrace => event.type === 'work_trace',
    )!
    expect(failing).toMatchObject({ hook: 'PostToolUseFailure', error: true, captures: [{ name: 'tests', lines: ['# tests 2', '# pass 1', '# fail 1'] }] })
  })
})

describe("Claude Code's note on a command that changed directory", () => {
  it('is no part of what the command printed', () => {
    const trace = traceOf('Bash', 'cd /p && npm test', `${NODE_TEST}\nShell cwd was reset to /home/user/project`)
    expect(trace.captures![0]!.lines).toEqual(['# tests 2', '# pass 1', '# fail 1'])
  })
})
