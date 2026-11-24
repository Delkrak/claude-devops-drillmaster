import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildComplaintGroupingPrompt, complaintsByTool, drillmasterPageView, readComplaintGroupingAnswer } from '../../src/core/drillmasterPage.js'
import type { DrillmasterEvent } from '../../src/core/events.js'

const fixture = JSON.parse(readFileSync(new URL('../viewer/fixtures/reviewed-run.json', import.meta.url), 'utf8')) as DrillmasterEvent[]
const TOOLS = ['work_start', 'work_report', 'work_gate', 'work_deliver', 'work_status']
/** The run as recorded, before Drillmaster grouped its complaints. */
const ungrouped = fixture.filter((event) => event.type !== 'complaints_grouped')

describe("the page of what's wrong in Drillmaster", () => {
  it('ranks its tools by how often they are complained about, each with its problems biggest first', () => {
    const page = drillmasterPageView(fixture, TOOLS)
    expect(page.tools.map((tool) => [tool.tool, tool.heard])).toEqual([
      ['work_deliver', 7],
      ['work_gate', 3],
      ['work_start', 2],
      ['work_status', 1],
    ])
    const deliver = page.tools[0]!
    expect(deliver.problems.map((problem) => problem.complaints.length)).toEqual([5, 1, 1])
    expect(deliver.problems[0]!.summary).toMatch(/uncommitted/)
    expect(deliver.ungrouped).toEqual([])
  })

  it('shows complaints made after the last grouping as ungrouped, newest first', () => {
    const page = drillmasterPageView(ungrouped, TOOLS)
    expect(page.tools[0]).toMatchObject({ tool: 'work_deliver', heard: 7, problems: [] })
    expect(page.tools[0]!.ungrouped[0]).toMatchObject({ source: 'drillmaster post mortem', issue: '#7' })
  })

  it('lists what a shown measure counted that no workflow step covers, and old step-ins no step covers, with why', () => {
    expect(drillmasterPageView(fixture, TOOLS).uncovered).toMatchObject([
      { source: 'your step-in', issue: '#4', text: expect.stringContaining('no step of this workflow covers') },
      { source: 'a measure', issue: '#2', text: expect.stringMatching(/^process friction: "You said the test failed before the fix.*no step requires the evidence/) },
    ])
  })

  it('counts an impediment Agent reported that names a tool, also by its MCP name', () => {
    const impediment = { id: 'ev_x', at: '2026-11-23T00:00:00.000Z', type: 'work_reported', work_item_id: 'wi_x', stage: 1, step: 1, kind: 'impediment', text: 'mcp__drillmaster__work_status does not say the gate.' } as DrillmasterEvent
    const status = drillmasterPageView([...fixture, impediment], TOOLS).tools.find((tool) => tool.tool === 'work_status')!
    expect(status.ungrouped).toMatchObject([{ id: 'ev_x', source: 'agent impediment' }])
    expect(drillmasterPageView([...fixture, impediment], TOOLS).tools.find((tool) => tool.tool === 'work_start')!.ungrouped).toEqual([])
  })

  it('asks Drillmaster to group each tool\'s complaints, and keeps only the tools and complaints it asked about, each once', () => {
    const byTool = complaintsByTool(ungrouped, TOOLS)
    const [first, second] = byTool.get('work_gate')!
    expect(buildComplaintGroupingPrompt(byTool)).toContain(`- ${first!.id} (drillmaster post mortem, ${first!.issue}): `)
    const answer = {
      groups: [
        { tool: 'work_gate', summary: 'diff files land in the project', complaints: [first!.id, 'ev_unknown#0'] },
        { tool: 'work_gate', summary: 'the same one again', complaints: [first!.id, second!.id] },
        { tool: 'no_such_tool', summary: 'x', complaints: [first!.id] },
      ],
    }
    expect(readComplaintGroupingAnswer(byTool, answer)).toEqual([
      { tool: 'work_gate', summary: 'diff files land in the project', complaints: [first!.id] },
      { tool: 'work_gate', summary: 'the same one again', complaints: [second!.id] },
    ])
  })
})
