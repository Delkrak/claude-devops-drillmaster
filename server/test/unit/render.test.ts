import { describe, expect, it } from 'vitest'
import { renderDelivered, renderGateOutcome, renderStarted, renderStep } from '../../src/core/render.js'
import { workflowZero } from '../../src/core/workflow.js'
import { OBJECTIVE, WORKFLOW_2, WORKFLOW_3 } from '../helpers.js'

const SIZE = {
  name: 'size',
  categories: [
    { value: 'small', description: 'one file' },
    { value: 'large', description: 'several files' },
  ],
  at: { stage: 1, step: 1 },
  by: 'agent' as const,
  instruction: 'How big is the change?',
}

describe('rendering the next work step', () => {
  it('gives the step in full: purpose, instruction, gate, rules, report, metrics, experiments and the gate call', () => {
    const step = renderStep({ ...WORKFLOW_2, metrics: [SIZE] }, 1, 1)
    expect(step).toMatchInlineSnapshot(`
      "## Work step 1.1: run the tests

      Stage 1 "build": the change works and is described

      **Do this:**
      > Run npm test.

      **Gate:** self (you judge it yourself).

      **Rules the gate checks:**
      - none

      **Report with the gate:** test result.

      **Metrics taken at this step:**
      - \`size\`, by agent: How big is the change? Categories: \`small\` (one file), \`large\` (several files).

      **Running experiments:**
      - #1 add pr 1.1: A PR rule stops the corrections

      When the work is done, hand in the gate with \`work_gate\`, one self check per rule:
      \`\`\`json
      {
        "token": "<your agent_token>",
        "stage": 1,
        "step": 1,
        "self_check": [],
        "text": "<test result>",
        "metrics": [
          {
            "name": "size",
            "value": "small|large",
            "explanation": "<why>"
          }
        ]
      }
      \`\`\`"
    `)
  })

  it('names each rule with how it is verified, and says who judges the gate', () => {
    const step = renderStep(WORKFLOW_3, 2, 1)
    expect(step).toContain('**Gate:** owner (Owner approves it).')
    expect(step).toContain('- `pr 1.1`: the PR says what it changes. Verified by: reading the PR description.')
    expect(step).toContain('"rule": "pr 1.1"')
  })

  it('says when a step has no instruction yet', () => {
    const withoutInstruction = structuredClone(WORKFLOW_3)
    withoutInstruction.stages[0]!.steps[0]!.instruction = ''
    expect(renderStep(withoutInstruction, 1, 1)).toContain('No instruction yet')
  })
})

describe('rendering results', () => {
  it('starts with the id, the token and the first step', () => {
    const started = renderStarted({ workItemId: 'wi_1', agentToken: 'tok', issue: '#7', workflow: WORKFLOW_3, position: { stage: 1, step: 1 } })
    expect(started).toContain('work_item_id: wi_1')
    expect(started).toContain('agent_token: tok')
    expect(started).toContain('## Work step 1.1: run the tests')
  })

  it('starts without steps on workflow 0.0.0', () => {
    const started = renderStarted({ workItemId: 'wi_1', agentToken: 'tok', issue: '#7', workflow: workflowZero(OBJECTIVE as never), position: { stage: null, step: null } })
    expect(started).toContain('no work stages yet')
  })

  it('follows an accepted gate with the next step, and a rejection with what to do', () => {
    expect(renderGateOutcome(WORKFLOW_3, { verdict: 'accepted', by: 'agent', stage: 1, step: 1, next: { stage: 1, step: 2 }, done: false })).toContain(
      '## Work step 1.2: say what the pull request changes',
    )
    expect(renderGateOutcome(WORKFLOW_3, { verdict: 'accepted', by: 'owner', stage: 2, step: 1, next: { stage: null, step: null }, done: true })).toContain('Deliver with `work_deliver`')
    const rejected = renderGateOutcome(WORKFLOW_3, { verdict: 'rejected', by: 'drillmaster', rule: 'pr 1.1', why: 'no What', stage: 1, step: 2, next: { stage: 1, step: 1 } })
    expect(rejected).toContain('citing `pr 1.1`: no What')
    expect(rejected).toContain('## Work step 1.1')
  })

  it('asks for the post mortem after delivery', () => {
    expect(renderDelivered('wi_1', '#40', ['shot.png'])).toContain('Artifacts: shot.png')
    expect(renderDelivered('wi_1', '#40', [])).toContain('work_post_mortem')
  })
})
