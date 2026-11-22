import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { migrateWorkflow } from '../../src/core/workflow.js'
import { seedWorkflow, testPorts, WORKFLOW_DM } from '../helpers.js'

const DIR = '/projects/tool-capture'
/** Step 1.1 has a self gate, 1.2 a Drillmaster gate. */
const WITH_CAPTURE = migrateWorkflow({ ...WORKFLOW_DM, tool_captures: [{ name: 'tests', command: 'npm test', keep: '|~ `^# (pass|fail) ` | pattern `# <what> <count>`' }] })

describe('tool capture as gate evidence', () => {
  it("links each gate to the captures at its step, and shows them to Drillmaster's gate review", async () => {
    const ports = testPorts({ gate: [{ accepted: true, rule: null, why: 'The captured totals show the tests pass.' }] })
    await seedWorkflow(ports, DIR, WITH_CAPTURE)
    const app = new Drillmaster(ports)
    const started = await app.callTool(DIR, 'work_start', { issue: '#1', description: 'CSV export' })
    const { agent_token: token } = started.structuredContent as { agent_token: string }
    await app.hook(DIR, 'PostToolUse', { session_id: 's1', tool_name: 'mcp__plugin_devops-drillmaster_drillmaster__work_start', tool_response: started.content })
    const runTests = async (stdout: string) => {
      await app.hook(DIR, 'PostToolUse', { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout, stderr: '' } })
      return (await app.events(DIR)).filter((event) => event.type === 'work_trace').at(-1)!.id
    }
    const atBuild = await runTests('# pass 24\n# fail 1\n')
    await app.callTool(DIR, 'work_gate', { token, step: '1.1', self_check: [{ rule: 'test 1.1', accepted: true, evidence: 'the captured totals' }], text: 'green' })
    const atDescribe = await runTests('# pass 25\n# fail 0\n')
    await app.callTool(DIR, 'work_gate', { token, step: '1.2', self_check: [{ rule: 'pr 1.1', accepted: true, evidence: 'PR says it' }], text: 'adds CSV export' })
    const submitted = (await app.events(DIR)).filter((event) => event.type === 'gate_submitted')
    expect(submitted.map((event) => (event.type === 'gate_submitted' ? event.capture_traces : undefined))).toEqual([[atBuild], [atDescribe]])
    expect(ports.reviewer.requests.find((request) => request.kind === 'gate')!.prompt).toContain("captured tests (by the workflow's tool capture): # pass 25 | # fail 0")
  })
})
