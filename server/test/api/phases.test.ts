import { describe, expect, it } from 'vitest'
import { Drillmaster } from '../../src/app.js'
import { migrateWorkflow } from '../../src/core/workflow.js'
import { ownerAnswers, seedWorkflow, testPorts, WORKFLOW_3 } from '../helpers.js'

const check = (rule: string) => [{ rule, accepted: true, evidence: 'checked' }]
const textOf = (result: { content: { text: string }[] }) => result.content[0]!.text

/** WORKFLOW_3, where Owner's review (2.1) is done in a later session and allows a minor update first. */
const PHASED = (() => {
  const workflow = structuredClone(WORKFLOW_3)
  workflow.stages[1]!.steps[0]!.update = 'minor'
  return migrateWorkflow(workflow)
})()

async function project(dir: string) {
  const ports = testPorts()
  await seedWorkflow(ports, dir, PHASED)
  const app = new Drillmaster(ports)
  const tool = (name: string, args: Record<string, unknown>) => app.callTool(dir, name, args)
  const takeUp = async (name: 'work_start' | 'work_resume', args: Record<string, unknown>, session: string) => {
    const result = await tool(name, args)
    await app.hook(dir, 'PostToolUse', { session_id: session, tool_name: `mcp__plugin_devops-drillmaster_drillmaster__${name}`, tool_response: result.content })
    return result
  }
  return { app, ports, tool, takeUp }
}

describe('a work item in phases, one session each', () => {
  it('works only the stages it was asked to, stops after the last, and goes on in a later session', async () => {
    const { app, tool, takeUp } = await project('/projects/phases')
    const capture = await takeUp('work_start', { issue: '#4', description: 'CSV export', stages: ['1'] }, 'monday')
    expect(textOf(capture)).toContain('This session works on stage 1 "build", and stops when the last of them is done.')
    const { agent_token: mondayToken, work_item_id: workItemId } = capture.structuredContent as { agent_token: string; work_item_id: string }
    await tool('work_gate', { token: mondayToken, step: '1.1', self_check: check('test 1.1'), text: 'green' })
    const lastOfStage = await tool('work_gate', { token: mondayToken, step: '1.2', self_check: check('pr 1.1'), text: 'PR #4' })
    expect(lastOfStage.structuredContent).toMatchObject({ verdict: 'accepted', session_done: true, next: { stage: 2, step: 1 } })
    expect(textOf(lastOfStage)).toContain("**This session's stages are done.**")
    expect(textOf(lastOfStage)).not.toContain('## Work step 2.1')
    expect(textOf(await tool('work_gate', { token: mondayToken, step: '2.1', text: 'PR #4' }))).toMatch(/in a stage this session doesn't work on; it works on stage 1 "build"/)

    const review = await takeUp('work_resume', { issue: '#4', stages: ['2'] }, 'thursday')
    const { agent_token: thursdayToken } = review.structuredContent as { agent_token: string }
    expect(thursdayToken).not.toBe(mondayToken)
    expect(textOf(review)).toContain('# Work item wi_1 resumed: #4')
    expect(textOf(review)).toContain('## Work step 2.1: Owner approves')
    expect(textOf(await tool('work_status', { token: mondayToken }))).toMatch(/Unknown token/)
    expect((await app.state('/projects/phases')).workItems[workItemId]).toMatchObject({ sessions: ['monday', 'thursday'], resumed: 1 })

    expect((await tool('work_gate', { token: thursdayToken, step: '2.1', text: 'PR #4' })).structuredContent).toMatchObject({ verdict: 'pending', gate: 'owner' })
    expect(await ownerAnswers(app, '/projects/phases', () => 'Approve', 'thursday')).toMatch(/Every work gate has passed/)
  })

  it('updates on resuming at a step that allows it, and says when the step to redo is outside the session', async () => {
    const { ports, tool, takeUp, app } = await project('/projects/phases-update')
    const capture = await takeUp('work_start', { issue: '#5', description: 'JSON export', stages: ['1'] }, 'monday')
    const { agent_token: token } = capture.structuredContent as { agent_token: string }
    await tool('work_gate', { token, step: '1.1', self_check: check('test 1.1'), text: 'green' })
    await tool('work_gate', { token, step: '1.2', self_check: check('pr 1.1'), text: 'PR #5' })

    ports.reviewer.enqueue('retrospective', {
      findings: { should: 's', did: 'd', why: 'w', keep: [], improve: [] },
      proposals: [{ change: 'email the stakeholders', purpose: 'p', measure: 'owner_friction_per_item', ops: [{ op: 'add_step', stage: '1', step: { name: 'send email', instruction: 'Email them.', gate: 'self', rules: [], report: [] } }] }],
    })
    await tool('workflow_retrospective', { action: 'run' })
    await ownerAnswers(app, '/projects/phases-update', () => 'Approve', 'wednesday')
    await tool('workflow_retrospective', { action: 'apply' })

    const resumed = await takeUp('work_resume', { issue: '#5', stages: ['2'] }, 'thursday')
    expect(resumed.structuredContent).toMatchObject({ workflow_version: '4.0.0', stage: 1, step: 3, update: { kept: ['1.1', '1.2'] } })
    expect(textOf(resumed)).toContain('**The work item updated from workflow 3.0.0 to 4.0.0**')
    expect(textOf(resumed)).toContain("The work item is at step 1.3, which is not in the stages this session works on. Tell Owner, and don't go on.")
  })

  it('refuses a start outside the first stage, and a resume of an issue with no open work item', async () => {
    const { tool } = await project('/projects/phases-refused')
    expect(textOf(await tool('work_start', { issue: '#6', description: 'd', stages: ['2'] }))).toMatch(/starts at step 1.1, in stage 1 "build", which isn't among the stages you named/)
    expect(textOf(await tool('work_start', { issue: '#6', description: 'd', stages: ['9'] }))).toBe('There is no stage 9 in workflow 3.0.0.')
    expect(textOf(await tool('work_resume', { issue: '#404' }))).toMatch(/No open work item has issue "#404"/)
  })
})
