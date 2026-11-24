// Gives a recorded run the measures Owner defined, and judges them in Drillmaster's post mortems of the
// work items named, the way the app does after delivery: the run was recorded before workflows
// defined their measures. The work items not named keep their old friction.
// npx tsx test/viewer/fixtures/judge-measures.ts test/viewer/fixtures/reviewed-run.json "#5" "#6" "#7" "#8"
import { readFileSync, writeFileSync } from 'node:fs'
import { ClaudeReviewer } from '../../../src/adapters/claudeReviewer.js'
import type { DrillmasterEvent } from '../../../src/core/events.js'
import { OWNER_FRICTION } from '../../../src/core/measures.js'
import { buildPostMortemPrompt, readPostMortemAnswer } from '../../../src/core/retro.js'
import { foldState } from '../../../src/core/state.js'
import { workflowOfWorkItem } from '../../../src/core/work.js'
import { TOOLS } from '../../../src/app.js'

const MEASURES = [
  { ...OWNER_FRICTION, show: false },
  { name: 'policy friction', definition: 'Owner caught what a rule should have caught.', show: true },
  { name: 'process friction', definition: 'Owner overruled an earlier decision, or the delivery was not what Owner wanted. Back-and-forth while refining the work does not count.', show: true },
]

const [file, ...issues] = process.argv.slice(2) as [string, ...string[]]
const events = JSON.parse(readFileSync(file, 'utf8')) as DrillmasterEvent[]
for (const event of events) if (event.type === 'project_initialized' || event.type === 'workflow_changed') (event.workflow as Record<string, unknown>).measures = MEASURES

const state = foldState(events)
const reviewer = new ClaudeReviewer()
for (const issue of issues) {
  const item = Object.values(state.workItems).find((candidate) => candidate.issue === issue)!
  const workflow = workflowOfWorkItem(state, item)
  const itemEvents = events.filter((event) => 'work_item_id' in event && event.work_item_id === item.work_item_id)
  const { answer } = await reviewer.review({ kind: 'post_mortem', prompt: buildPostMortemPrompt(item, workflow, events), minTimeoutMs: 180_000 })
  const { measured } = readPostMortemAnswer(
    answer,
    workflow,
    TOOLS.map((tool) => tool.name),
    new Set(itemEvents.map((event) => event.id)),
  )
  const postMortem = itemEvents.find((event) => event.type === 'post_mortem_written' && event.author === 'drillmaster')
  if (postMortem?.type !== 'post_mortem_written') throw new Error(`${issue} has no post mortem by Drillmaster`)
  postMortem.measured = measured
  console.log(issue, JSON.stringify(measured))
}
writeFileSync(file, JSON.stringify(events, null, 2) + '\n')
