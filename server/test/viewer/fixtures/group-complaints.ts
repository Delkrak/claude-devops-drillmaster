// Groups the complaints of a recorded run the way the app does at a retrospective: the run was
// recorded before Drillmaster grouped them. Appends one complaints_grouped event.
// npx tsx test/viewer/fixtures/group-complaints.ts test/viewer/fixtures/reviewed-run.json
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { ClaudeReviewer } from '../../../src/adapters/claudeReviewer.js'
import { buildComplaintGroupingPrompt, COMPLAINT_GROUPING_REVIEW_KIND, complaintsByTool, readComplaintGroupingAnswer } from '../../../src/core/drillmasterPage.js'
import type { DrillmasterEvent } from '../../../src/core/events.js'
import { TOOLS } from '../../../src/app.js'

const file = process.argv[2]!
const events = JSON.parse(readFileSync(file, 'utf8')) as DrillmasterEvent[]
const byTool = complaintsByTool(
  events,
  TOOLS.map((tool) => tool.name),
)
const { answer } = await new ClaudeReviewer().review({ kind: COMPLAINT_GROUPING_REVIEW_KIND, prompt: buildComplaintGroupingPrompt(byTool) })
const groups = readComplaintGroupingAnswer(byTool, answer)
const last = events.at(-1)!
events.push({
  id: `ev_${randomBytes(4).toString('hex')}`,
  at: new Date().toISOString(),
  workflow_version: last.workflow_version,
  drillmaster_version: last.drillmaster_version,
  writer: last.writer,
  type: 'complaints_grouped',
  groups,
} as DrillmasterEvent)
for (const group of groups) console.log(group.tool, group.complaints.length, group.summary)
writeFileSync(file, JSON.stringify(events, null, 2) + '\n')
