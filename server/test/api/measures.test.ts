import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { measureDeliveredItems } from '../../src/core/measures.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, seedWorkflow, testPorts } from '../helpers.js'

const DIR = '/projects/measures'
const POLICY_FRICTION = { name: 'policy friction', short: 'PF', color: 'orange' as const, definition: 'Owner caught what a rule should have caught.', show: true }
const PROCESS_FRICTION = { name: 'process friction', short: 'PC', color: 'rose' as const, definition: 'Owner overruled an earlier decision, or the delivery was not what Owner wanted.', show: true }
const NO_FINDINGS = { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [] }

async function workItemWithInputs() {
  const ports = testPorts()
  await seedWorkflow(ports, DIR, workflowZero(OBJECTIVE as never, [POLICY_FRICTION, PROCESS_FRICTION]))
  const app = new Drillmaster(ports)
  const hook = (name: string, payload: Record<string, unknown>) => app.hook(DIR, name, { session_id: 's1', ...payload })
  await hook('UserPromptSubmit', { prompt: 'do issue #1' })
  const started = await app.callTool(DIR, 'work_start', { issue: '#1', description: 'CSV export' })
  await hook('PostToolUse', { tool_name: 'mcp__plugin_devops-drillmaster_drillmaster__work_start', tool_response: started.content })
  await hook('UserPromptSubmit', { prompt: 'use ; as the separator' })
  await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/csv.js' }, tool_response: {} })
  const { agent_token: token } = started.structuredContent as { agent_token: string }
  const ownerPrompts = async () => (await app.events(DIR)).filter((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit').map((event) => event.id)
  return { app, ports, hook, token, ownerPrompts }
}

const postMortem = (measured: unknown) => ({ keep: [], change: [], experiment_reflections: [], measured })

describe("the measures, judged in Drillmaster's post mortem", () => {
  it('judges each measure the workflow defines once the work item is delivered, and counts its occurrences', async () => {
    const { app, ports, token, ownerPrompts } = await workItemWithInputs()
    const [, separatorInput] = await ownerPrompts()
    ports.reviewer.enqueue('post_mortem', postMortem([{ measure: 'policy friction', occurrences: [{ step: null, events: [separatorInput], why: 'A rule on the CSV format should have caught it.' }] }]))
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    const prompt = ports.reviewer.requests.find((request) => request.kind === 'post_mortem')!.prompt
    expect(prompt).toContain('- "policy friction": Owner caught what a rule should have caught.')
    expect(prompt).toContain(`- ${separatorInput} UserPromptSubmit Owner: "use ; as the separator"`)
    const events = await app.events(DIR)
    expect(events.find((event) => event.type === 'post_mortem_written' && event.author === 'drillmaster')).toMatchObject({
      measured: [
        { measure: 'policy friction', occurrences: [{ step_guid: null, events: [separatorInput], why: 'A rule on the CSV format should have caught it.' }] },
        { measure: 'process friction', occurrences: [] },
      ],
    })
    expect(measureDeliveredItems(events)[0]!.values).toMatchObject({ 'policy friction': 1, 'process friction': 0 })
    expect(ports.reviewer.requests.some((request) => request.kind === 'friction')).toBe(false)
  })

  it('tries a failed post mortem again at the retrospective, and records the failure, unjudged, when that fails too', async () => {
    const { app, ports, token } = await workItemWithInputs()
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    expect((await app.events(DIR)).some((event) => event.type === 'post_mortem_written')).toBe(false)
    ports.reviewer.enqueue('retrospective', NO_FINDINGS)
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    const events = await app.events(DIR)
    const recorded = events.find((event) => event.type === 'post_mortem_written' && event.author === 'drillmaster')
    expect(recorded).toMatchObject({ change: [{ text: expect.stringContaining('Drillmaster could not write its post mortem') }] })
    expect(recorded).not.toHaveProperty('measured')
    expect(measureDeliveredItems(events)[0]!.values).not.toHaveProperty('policy friction')
  })

  it('judges what Owner said after the post mortem at the retrospective, adding to what it judged before', async () => {
    const { app, ports, hook, token } = await workItemWithInputs()
    ports.reviewer.enqueue('post_mortem', postMortem([]))
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    await hook('UserPromptSubmit', { prompt: 'that is not what I asked for: I wanted a download button' })
    await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/button.js' }, tool_response: {} })
    const late = (await app.events(DIR)).filter((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit').at(-1)!.id
    ports.reviewer.enqueue('late_measures', { measured: [{ measure: 'process friction', occurrences: [{ step: null, events: [late], why: 'The delivery was not what Owner wanted.' }] }] })
    ports.reviewer.enqueue('retrospective', NO_FINDINGS)
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    const latePrompt = ports.reviewer.requests.find((request) => request.kind === 'late_measures')!.prompt
    expect(latePrompt).toContain('"that is not what I asked for: I wanted a download button"')
    expect(latePrompt).not.toContain('"use ; as the separator"')
    const events = await app.events(DIR)
    expect(measureDeliveredItems(events)[0]!.values).toMatchObject({ 'policy friction': 0, 'process friction': 1 })
    ports.reviewer.enqueue('retrospective', NO_FINDINGS)
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    expect(ports.reviewer.requests.filter((request) => request.kind === 'late_measures')).toHaveLength(1)
  })
})

describe("Drillmaster's grouping of the complaints about its tools", () => {
  it('groups the complaints at a retrospective, once there are new ones', async () => {
    const { app, ports, token } = await workItemWithInputs()
    ports.reviewer.enqueue('post_mortem', postMortem([]))
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.callTool(DIR, 'work_post_mortem', { token, keep: [], change: [{ refs: ['tool work_deliver'], text: 'Local deliveries stay uncommitted.' }], experiment_reflections: [] })
    await app.idle()
    const [complaint] = (await app.events(DIR)).filter((event) => event.type === 'post_mortem_written' && event.author === 'agent')
    ports.reviewer.enqueue('complaint_grouping', { groups: [{ tool: 'work_deliver', summary: 'Deliveries stay uncommitted', complaints: [`${complaint!.id}#0`] }] })
    ports.reviewer.enqueue('retrospective', NO_FINDINGS)
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    await app.idle()
    expect(ports.reviewer.requests.find((request) => request.kind === 'complaint_grouping')!.prompt).toContain('Local deliveries stay uncommitted.')
    expect((await app.events(DIR)).find((event) => event.type === 'complaints_grouped')).toMatchObject({ groups: [{ tool: 'work_deliver', summary: 'Deliveries stay uncommitted' }] })
  })
})
