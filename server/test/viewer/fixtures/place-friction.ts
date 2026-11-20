// Places the step-ins of a recorded run the way the app does after its friction judge: the run was
// recorded before Drillmaster placed friction. Appends one friction_placed event per work item.
// npx tsx test/viewer/fixtures/place-friction.ts test/viewer/fixtures/reviewed-run.json
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { ClaudeReviewer } from '../../../src/adapters/claudeReviewer.js'
import type { DrillmasterEvent } from '../../../src/core/events.js'
import { buildFrictionPlacementPrompt, frictionPlacementsOf, FRICTION_PLACEMENT_REVIEW_KIND, readFrictionPlacementAnswer } from '../../../src/core/frictionPlacement.js'
import { frictionJudgementsOf, ownerInputsOf } from '../../../src/core/ownerInputs.js'
import { foldState } from '../../../src/core/state.js'
import { workflowOfWorkItem } from '../../../src/core/work.js'

const file = process.argv[2]!
const events = JSON.parse(readFileSync(file, 'utf8')) as DrillmasterEvent[]
const state = foldState(events)
const judgements = frictionJudgementsOf(events)
const placed = frictionPlacementsOf(events)
const last = events.at(-1)!
const reviewer = new ClaudeReviewer()

const unplaced = ownerInputsOf(events).filter((input) => input.work_item_id && judgements.get(input.event_id)?.friction && !placed.has(input.event_id))
for (const workItemId of new Set(unplaced.map((input) => input.work_item_id!))) {
  const item = state.workItems[workItemId]!
  const workflow = workflowOfWorkItem(state, item)
  const frictions = unplaced.filter((input) => input.work_item_id === workItemId).map((input) => ({ input, judgement: judgements.get(input.event_id)! }))
  const { answer } = await reviewer.review({ kind: FRICTION_PLACEMENT_REVIEW_KIND, prompt: buildFrictionPlacementPrompt(workflow, item, frictions) })
  const inputs = readFrictionPlacementAnswer(
    workflow,
    frictions.map(({ input }) => input.event_id),
    answer,
  )
  events.push({
    id: `ev_${randomBytes(4).toString('hex')}`,
    at: new Date().toISOString(),
    workflow_version: last.workflow_version,
    drillmaster_version: last.drillmaster_version,
    writer: last.writer,
    type: 'friction_placed',
    work_item_id: workItemId,
    inputs,
  } as DrillmasterEvent)
  console.log(item.issue, JSON.stringify(inputs))
}
writeFileSync(file, JSON.stringify(events, null, 2) + '\n')
