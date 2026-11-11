import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { folderKey as projectId } from '../../src/adapters/projects.js'
import type { WorkflowDocument } from '../../src/core/workflow.js'
import { ownerAnswers, seedWorkflow, tempDir, testPorts, WORKFLOW_3 } from '../helpers.js'

const option = (value: string) => ({ value, description: `a ${value} one` })
/** WORKFLOW_3 with Agent's size input at 1.1 and Drillmaster's risk input at 1.2. */
const WORKFLOW_INPUTS: WorkflowDocument = {
  ...WORKFLOW_3,
  inputs: [
    { name: 'size', options: [option('small'), option('large')], guid: 'guid-size', set_at: '1.1', by: 'agent', instruction: 'How big is it?' },
    { name: 'risk', options: [option('low'), option('high')], guid: 'guid-risk', set_at: '1.2', by: 'drillmaster', instruction: 'How risky is it?' },
  ],
}

let work: Awaited<ReturnType<typeof tempDir>>
let app: Drillmaster
let ports: ReturnType<typeof testPorts>
const check = (rule: string) => [{ rule, accepted: true, evidence: 'checked' }]

beforeAll(async () => {
  work = await tempDir('deliver')
  execFileSync('git', ['init', '-q'], { cwd: work.dir })
  await writeFile(path.join(work.dir, 'after.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(path.join(work.dir, '.gitignore'), 'private.txt\n')
  await writeFile(path.join(work.dir, 'private.txt'), 'TOKEN=x')
  ports = testPorts({ inputs: [{ inputs: [{ name: 'risk', value: 'high', explanation: 'touches exports' }, { name: 'size', value: 'small' }] }] })
  await seedWorkflow(ports, work.dir, WORKFLOW_INPUTS)
  app = new Drillmaster(ports)
})
afterAll(() => work.remove())

describe('work item inputs and delivery', () => {
  let token: string

  it("takes Agent's input with the gate, and Drillmaster's after the gate in the background", async () => {
    const started = await app.callTool(work.dir, 'work_start', { issue: '#5', description: 'Add a PNG export.' })
    token = (started.structuredContent as { agent_token: string; work_item_id: string }).agent_token
    await app.hook(work.dir, 'PostToolUse', { session_id: 's1', tool_name: 'work_start', tool_response: started.content })
    expect(started.content[0]!.text).toContain('`size`, by agent: How big is it?')
    const refused = await app.callTool(work.dir, 'work_gate', { token, step: '1.1', self_check: check('test 1.1'), text: 'green' })
    expect(refused).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Work can't go on without input "size"/) }] })
    await app.callTool(work.dir, 'work_gate', { token, step: '1.1', self_check: check('test 1.1'), text: 'green', inputs: [{ name: 'size', value: 'small' }] })
    await app.callTool(work.dir, 'work_gate', { token, step: '1.2', self_check: check('pr 1.1'), text: 'adds PNG export' })
    await app.idle()
    const item = Object.values((await app.state(work.dir)).workItems)[0]!
    // Drillmaster's answer also named "size", which is not its to take: only "risk" is recorded from it.
    expect(item.inputs).toEqual({ size: { value: 'small', by: 'agent' }, risk: { value: 'high', by: 'drillmaster', explanation: 'touches exports' } })
    expect(item.description).toBe('Add a PNG export.')
  })

  it('delivers with a summary and an image artifact, and refuses a git-ignored file', async () => {
    await app.callTool(work.dir, 'work_gate', { token, step: '2.1', self_check: check('pr 1.1'), text: 'PR #41' })
    await ownerAnswers(app, work.dir, () => 'Approve')
    const ignored = await app.callTool(work.dir, 'work_deliver', { token, pr: '#41', summary: 's', artifacts: ['private.txt'] })
    expect(ignored).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/ignored by git/) }] })
  })

  it('stores the artifact copy and records it on the work item', async () => {
    const delivered = await app.callTool(work.dir, 'work_deliver', { token, pr: '#41', summary: 'PNG export, checked by eye', artifacts: ['after.png'] })
    expect(delivered.isError).toBeUndefined()
    expect(delivered.content[0]!.text).toContain('Artifacts: after.png')
    const after = Object.values((await app.state(work.dir)).workItems)[0]!
    expect(after).toMatchObject({ status: 'delivered', summary: 'PNG export, checked by eye', artifacts: [{ name: 'after.png', media_type: 'image/png', bytes: 4 }] })
    expect(await ports.artifacts.read(projectId(work.dir), after.work_item_id, 'after.png')).toHaveLength(4)
  })
})
