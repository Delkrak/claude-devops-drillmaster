import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { drillmasterPageView } from '../../src/core/drillmasterPage.js'
import type { DrillmasterEvent } from '../../src/core/events.js'

const fixture = JSON.parse(readFileSync(new URL('../viewer/fixtures/reviewed-run.json', import.meta.url), 'utf8')) as DrillmasterEvent[]
const TOOLS = ['work_start', 'work_report', 'work_gate', 'work_deliver', 'work_status']

describe("the page of what's wrong in Drillmaster", () => {
  it('ranks its tools by how often the post mortems complain about them, then by how recently', () => {
    const page = drillmasterPageView(fixture, TOOLS)
    expect(page.tools.map((tool) => [tool.tool, tool.complaints.length])).toEqual([
      ['work_deliver', 7],
      ['work_gate', 3],
      ['work_start', 2],
      ['work_status', 1],
    ])
    expect(page.tools[0]!.complaints[0]).toMatchObject({ source: 'drillmaster post mortem', issue: '#7' })
    expect(page.tools[3]!.complaints[0]).toMatchObject({ source: 'agent post mortem', issue: '#1', text: expect.stringContaining('work_status gave the position') })
  })

  it("lists Owner's step-ins that no workflow step covers, with why", () => {
    expect(drillmasterPageView(fixture, TOOLS).uncovered).toMatchObject([{ source: 'your step-in', issue: '#4', text: expect.stringContaining('no step of this workflow covers') }])
  })

  it('counts an impediment Agent reported that names a tool', () => {
    const impediment = { id: 'ev_x', at: '2026-11-21T00:00:00.000Z', type: 'work_reported', work_item_id: 'wi_x', stage: 1, step: 1, kind: 'impediment', text: 'work_status does not say the gate.' } as DrillmasterEvent
    const page = drillmasterPageView([...fixture, impediment], TOOLS)
    expect(page.tools.find((tool) => tool.tool === 'work_status')!.complaints[0]).toMatchObject({ source: 'agent impediment', text: 'work_status does not say the gate.' })
  })

  it('shows what had been said by a moment', () => {
    expect(drillmasterPageView(fixture, TOOLS, '2026-11-20T19:00:00.000Z').tools.map((tool) => [tool.tool, tool.complaints.length])).toEqual([
      ['work_deliver', 2],
      ['work_gate', 2],
      ['work_status', 1],
    ])
  })
})
