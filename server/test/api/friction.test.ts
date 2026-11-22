import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { measureDeliveredItems } from '../../src/core/measures.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, seedWorkflow, testPorts } from '../helpers.js'

const DIR = '/projects/friction'

async function deliveredWithInputs() {
  const ports = testPorts()
  await seedWorkflow(ports, DIR, workflowZero(OBJECTIVE as never))
  const app = new Drillmaster(ports)
  const hook = (name: string, payload: Record<string, unknown>) => app.hook(DIR, name, { session_id: 's1', ...payload })
  await hook('UserPromptSubmit', { prompt: 'do issue #1' })
  const started = await app.callTool(DIR, 'work_start', { issue: '#1', description: 'CSV export' })
  await hook('PostToolUse', { tool_name: 'mcp__plugin_devops-drillmaster_drillmaster__work_start', tool_response: started.content })
  await hook('UserPromptSubmit', { prompt: 'use ; as the separator' })
  await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/csv.js' }, tool_response: {} })
  const { agent_token: token } = started.structuredContent as { agent_token: string }
  return { app, ports, hook, token }
}

describe('the friction judge', () => {
  it("judges Owner's inputs on a work item once it is delivered, apart from the workflow", async () => {
    const { app, ports, token } = await deliveredWithInputs()
    const events = await app.events(DIR)
    const [startInput, separatorInput] = events.filter((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit').map((event) => event.id)
    ports.reviewer.enqueue('friction', {
      inputs: [
        { event: startInput, friction: false, why: 'Owner handed Agent the work.' },
        { event: separatorInput, friction: true, why: 'Owner had to say what the issue left open.' },
      ],
    })
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    const request = ports.reviewer.requests.find((candidate) => candidate.kind === 'friction')!
    expect(request.prompt).toContain('"use ; as the separator"')
    expect(request.prompt).not.toContain('Current workflow')
    const after = await app.events(DIR)
    expect(after.find((event) => event.type === 'owner_inputs_judged')).toMatchObject({ inputs: [{ event: startInput, friction: false }, { event: separatorInput, friction: true }] })
    expect(measureDeliveredItems(after)[0]!.values.owner_friction_per_item).toBe(1)
  })

  it('judges what came after delivery before a retrospective reads it', async () => {
    const { app, ports, hook, token } = await deliveredWithInputs()
    ports.reviewer.enqueue('friction', { inputs: [] })
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    await hook('UserPromptSubmit', { prompt: 'you forgot the CHANGES.md line' })
    await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'CHANGES.md' }, tool_response: {} })
    const late = (await app.events(DIR)).filter((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit').at(-1)!.id
    ports.reviewer.enqueue('friction', { inputs: [{ event: late, friction: true, why: 'Owner had to remind Agent.' }] })
    ports.reviewer.enqueue('retrospective', { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [] })
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    const retroPrompt = ports.reviewer.requests.find((candidate) => candidate.kind === 'retrospective')!.prompt
    expect(retroPrompt).toContain('"you forgot the CHANGES.md line" (friction: Owner had to remind Agent.)')
  })
})

describe("Drillmaster's placement of friction", () => {
  it('places each input judged friction at the step that should have caught it, with the workflow the judge never saw', async () => {
    const { app, ports, token } = await deliveredWithInputs()
    const events = await app.events(DIR)
    const [startInput, separatorInput] = events.filter((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit').map((event) => event.id)
    ports.reviewer.enqueue('friction', {
      inputs: [
        { event: startInput, friction: false, why: 'Owner handed Agent the work.' },
        { event: separatorInput, friction: true, why: 'Owner had to say what the issue left open.' },
      ],
    })
    ports.reviewer.enqueue('friction_placement', { inputs: [{ event: separatorInput, step: '1.1', why: 'Capturing the work should have asked for the separator.' }] })
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    const request = ports.reviewer.requests.find((candidate) => candidate.kind === 'friction_placement')!
    expect(request.prompt).toContain('"use ; as the separator" (why friction: Owner had to say what the issue left open.)')
    expect(request.prompt).not.toContain(startInput)
    const placed = (await app.events(DIR)).find((event) => event.type === 'friction_placed')
    expect(placed).toMatchObject({ inputs: [{ event: separatorInput, why: 'Capturing the work should have asked for the separator.' }] })
  })
})

describe("Drillmaster's grouping of the complaints about its tools", () => {
  it('groups the complaints at a retrospective, once there are new ones', async () => {
    const { app, ports, token } = await deliveredWithInputs()
    ports.reviewer.enqueue('friction', { inputs: [] })
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.callTool(DIR, 'work_post_mortem', { token, keep: [], change: [{ refs: ['tool work_deliver'], text: 'Local deliveries stay uncommitted.' }], experiment_reflections: [] })
    await app.idle()
    const [complaint] = (await app.events(DIR)).filter((event) => event.type === 'post_mortem_written' && event.author === 'agent')
    ports.reviewer.enqueue('complaint_grouping', { groups: [{ tool: 'work_deliver', summary: 'Deliveries stay uncommitted', complaints: [`${complaint!.id}#0`] }] })
    ports.reviewer.enqueue('retrospective', { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [] })
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    await app.idle()
    expect(ports.reviewer.requests.find((request) => request.kind === 'complaint_grouping')!.prompt).toContain('Local deliveries stay uncommitted.')
    expect((await app.events(DIR)).find((event) => event.type === 'complaints_grouped')).toMatchObject({ groups: [{ tool: 'work_deliver', summary: 'Deliveries stay uncommitted' }] })
  })
})

describe('placing friction that could not be placed before', () => {
  it('places it at the next retrospective', async () => {
    const { app, ports, token } = await deliveredWithInputs()
    const separatorInput = (await app.events(DIR)).filter((event) => event.type === 'work_trace' && event.hook === 'UserPromptSubmit').at(-1)!.id
    ports.reviewer.enqueue('friction', { inputs: [{ event: separatorInput, friction: true, why: 'Owner had to say it.' }] })
    // no answer for the placement: the reviewer fails it
    await app.callTool(DIR, 'work_deliver', { token, pr: 'local', summary: 'CSV export' })
    await app.idle()
    expect((await app.events(DIR)).some((event) => event.type === 'friction_placed')).toBe(false)
    ports.reviewer.enqueue('friction_placement', { inputs: [{ event: separatorInput, step: null, why: 'no step covers it' }] })
    ports.reviewer.enqueue('retrospective', { findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] }, proposals: [] })
    await app.callTool(DIR, 'workflow_retrospective', { action: 'run' })
    await app.idle()
    expect((await app.events(DIR)).find((event) => event.type === 'friction_placed')).toMatchObject({ inputs: [{ event: separatorInput, step_guid: null }] })
  })
})
