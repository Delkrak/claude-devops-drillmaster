import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { test } from '@playwright/test'
import { RUN_VIEWER_PORT } from './port.js'

// The screens the blind agents read (blind-read.md): the Workflow page at the moment of the accepted
// mock, docs/design/workflow.html, so the built page and the mock can be compared. They are saved to
// test-results/screens/, which git ignores; nothing here compares pixels.
// Run with: npx playwright test --grep @screens

const RUN_VIEWER = `http://127.0.0.1:${RUN_VIEWER_PORT}`
const MOCK_MOMENT = '2026-11-20T19:10:16.785Z'
const SCREENS = path.resolve(import.meta.dirname, '../../test-results/screens')

test.use({ viewport: { width: 1440, height: 900 } })

test('the Workflow page at the mock moment @screens', async ({ page }) => {
  mkdirSync(SCREENS, { recursive: true })
  const { project } = (await (await page.request.get(`${RUN_VIEWER}/api/served`)).json()) as { project: string }
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  await page.getByTestId('workflow-overview').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(SCREENS, 'workflow-0-landing.png') })
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  const stops = [0.33, 0.66, 1]
  for (const [index, share] of stops.entries()) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollable * share))
    await page.screenshot({ path: path.join(SCREENS, `workflow-${index + 1}-scrolled.png`) })
  }
})

// The work item page as docs/design/work-item.html shows it: #2 delivered, drilled one level at a
// time, #5 in flight at the Workflow mock's moment, and the work items list.
test('the work item page @screens', async ({ page }) => {
  mkdirSync(SCREENS, { recursive: true })
  const { project } = (await (await page.request.get(`${RUN_VIEWER}/api/served`)).json()) as { project: string }
  const items = ((await (await page.request.get(`${RUN_VIEWER}/api/projects/${project}/work-items`)).json()) as { items: { issue: string; work_item_id: string }[] }).items
  const idOf = (issue: string) => items.find((item) => item.issue === issue)!.work_item_id
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items/${idOf('#2')}`)
  await page.getByTestId('item-state').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(SCREENS, 'item-0-landing.png') })
  const failingTest = page.getByRole('button', { name: '3.1 reproduce the bug with a failing test', exact: true })
  await failingTest.click()
  await page.mouse.move(0, 0)
  await failingTest.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 140))
  await page.screenshot({ path: path.join(SCREENS, 'item-1-what-happened.png') })
  await page.getByRole('button', { name: 'the evidence ›' }).click()
  await page.screenshot({ path: path.join(SCREENS, 'item-2-evidence.png') })
  await page.getByRole('button', { name: /every tool call/ }).click()
  await page.screenshot({ path: path.join(SCREENS, 'item-3-tool-calls.png') })
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items/${idOf('#5')}?at=${MOCK_MOMENT}`)
  await page.getByTestId('item-state').waitFor()
  await page.screenshot({ path: path.join(SCREENS, 'item-4-in-flight.png') })
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items`)
  await page.getByTestId('item-row').first().waitFor()
  await page.screenshot({ path: path.join(SCREENS, 'item-5-list.png') })
})

// The changes page: each change's measure before and after, one opened.
test('the changes page @screens', async ({ page }) => {
  mkdirSync(SCREENS, { recursive: true })
  const { project } = (await (await page.request.get(`${RUN_VIEWER}/api/served`)).json()) as { project: string }
  await page.goto(`${RUN_VIEWER}/#/p/${project}/changes`)
  await page.getByTestId('change').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(SCREENS, 'changes-0-list.png') })
  await page.getByTestId('change').nth(1).getByRole('button').click()
  await page.screenshot({ path: path.join(SCREENS, 'changes-1-opened.png') })
})

// What's wrong in Drillmaster: its tools by complaints, the first opened.
test('the complaints page @screens', async ({ page }) => {
  mkdirSync(SCREENS, { recursive: true })
  const { project } = (await (await page.request.get(`${RUN_VIEWER}/api/served`)).json()) as { project: string }
  await page.goto(`${RUN_VIEWER}/#/p/${project}/complaints`)
  await page.getByTestId('complaint-group').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(SCREENS, 'complaints-0-list.png') })
  await page.getByTestId('complaint-group').first().getByRole('button').click()
  await page.screenshot({ path: path.join(SCREENS, 'complaints-1-opened.png') })
})

// The measures as Owner chose to tell them apart: a pill per measure in its own colour, its short name
// and count. At the end of the run, where #1 and #2 have judged measures and #4 old friction.
test('the measures @screens', async ({ page }) => {
  mkdirSync(SCREENS, { recursive: true })
  const { project } = (await (await page.request.get(`${RUN_VIEWER}/api/served`)).json()) as { project: string }
  const items = ((await (await page.request.get(`${RUN_VIEWER}/api/projects/${project}/work-items`)).json()) as { items: { issue: string; work_item_id: string }[] }).items
  const idOf = (issue: string) => items.find((item) => item.issue === issue)!.work_item_id
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow`)
  await page.getByTestId('workflow-overview').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(SCREENS, 'measures-0-workflow.png') })
  await page.locator('#stage-3').evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 60))
  await page.screenshot({ path: path.join(SCREENS, 'measures-1-stage-3.png') })
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items/${idOf('#2')}`)
  await page.getByTestId('item-state').waitFor()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.screenshot({ path: path.join(SCREENS, 'measures-2-item.png') })
  const failingTest = page.getByRole('button', { name: '3.1 reproduce the bug with a failing test', exact: true })
  await failingTest.click()
  await page.mouse.move(0, 0)
  await failingTest.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 140))
  await page.screenshot({ path: path.join(SCREENS, 'measures-3-step.png') })
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items`)
  await page.getByTestId('item-row').first().waitFor()
  await page.screenshot({ path: path.join(SCREENS, 'measures-4-list.png') })
})
