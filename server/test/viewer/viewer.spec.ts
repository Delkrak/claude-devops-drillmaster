import { expect, test, type Page } from '@playwright/test'
import { RUN_VIEWER_PORT, VIEWER_PORT } from './port.js'
import { DEMO_DIR } from './global-setup.js'

const RUN_VIEWER = `http://127.0.0.1:${RUN_VIEWER_PORT}`
/** The moment the accepted mock shows: docs/design/workflow.html. */
const MOCK_MOMENT = '2026-11-20T19:10:16.785Z'

const servedProject = async (page: Page, server: string) => ((await (await page.request.get(`${server}/api/served`)).json()) as { project: string }).project
const walkStep = (page: Page, name: string) => page.getByTestId('walk-step').filter({ has: page.getByText(name, { exact: true }) })

test('opens on the Workflow page of the one project its server serves, and no other', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/#\/p\/gates-demo-[0-9a-f]+\/workflow$/)
  await expect(page.getByTestId('workflow-overview')).toBeVisible()
  const runProject = await servedProject(page, RUN_VIEWER)
  expect((await request.get(`/api/projects/${runProject}/workflow`)).status()).toBe(404)
})

test('lands on the overview alone; the walkthrough comes into frame below it', async ({ page }) => {
  await page.goto(`${RUN_VIEWER}/`)
  const viewport = page.viewportSize()!
  await expect(page.getByTestId('workflow-overview')).toBeInViewport()
  await expect(page.getByTestId('stage-row')).toHaveCount(5)
  const firstStage = await page.getByTestId('walk-stage').first().boundingBox()
  expect(firstStage!.y).toBeGreaterThanOrEqual(viewport.height)
  await page.getByTestId('walk-stage').first().scrollIntoViewIfNeeded()
  await expect(page.getByTestId('walk-stage').first()).toBeInViewport()
})

test("shows the recorded run at the mock's moment: #5 at Drillmaster's review, 4 delivered, 2 step-ins after delivery", async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  const overview = page.getByTestId('workflow-overview')
  await expect(overview.getByTestId('item-box')).toHaveAttribute('data-tip', '1 work item here now: #5')
  await expect(overview.getByTestId('delivered')).toHaveAttribute('data-tip', '4 work items delivered')
  await expect(overview.getByTestId('friction-ring')).toHaveAttribute('data-tip', 'you stepped in 2 times after delivery')
  const review = walkStep(page, 'have the change reviewed')
  await expect(review.getByTestId('stop')).toHaveAttribute('data-kind', 'review')
  await expect(review.getByTestId('item-box')).toHaveAttribute('data-tip', '1 work item here now: #5')
  await expect(review.getByTestId('reviews-passed')).toHaveText('✓ 4')
})

test('explains a symbol when the pointer rests on it', async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  const spec = walkStep(page, 'write the spec')
  await spec.scrollIntoViewIfNeeded()
  await spec.getByTestId('stop').hover()
  await expect(page.getByTestId('tip')).toHaveText("you approve this step: kind == 'feature'")
  await expect(page.getByTestId('key')).toContainText('Drillmaster reviews')
})

test("shows the demo's work sent back by Drillmaster, the item at Owner's gate, and the step-in after delivery", async ({ page }) => {
  await page.goto('/')
  await expect(walkStep(page, 'describe the PR').getByTestId('reviews-sent-back')).toHaveText('↩ 1')
  await expect(walkStep(page, 'Owner approves').getByTestId('item-box')).toHaveAttribute('data-tip', '1 work item here now: #2 JSON export')
  await expect(page.getByTestId('workflow-overview').getByTestId('friction-ring')).toHaveAttribute('data-tip', 'you stepped in 1 times after delivery')
})

test('follows a live session: a new work item appears without reloading', async ({ page, request }) => {
  await page.goto('/')
  const firstStage = page.getByTestId('stage-row').first()
  await expect(firstStage.getByTestId('item-box')).toHaveCount(0)
  await request.post(`http://127.0.0.1:${VIEWER_PORT}/tools/call`, { data: { project: DEMO_DIR, name: 'work_start', arguments: { issue: '#3 live', description: 'started while the viewer is open' } } })
  await expect(firstStage.getByTestId('item-box')).toHaveAttribute('data-tip', '1 work item here now: #3 live', { timeout: 10_000 })
})

test('jumps from a stage in the overview to where that stage is drawn in full', async ({ page }) => {
  await page.goto(`${RUN_VIEWER}/`)
  await expect(page.locator('#stage-3')).not.toBeInViewport()
  await page.getByRole('link', { name: 'go to stage 3, build' }).click()
  await expect(page.locator('#stage-3')).toBeInViewport()
  await page.goto(`${RUN_VIEWER}/`)
  await page.getByRole('link', { name: 'go to stage 4, test' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#stage-4')).toBeInViewport()
})

test('names a past moment and its workflow, with the way back to now; live names nothing', async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  await expect(page.getByTestId('moment')).toHaveText('20 Nov, 19:10 UTC · workflow 2.1.0')
  await page.getByRole('link', { name: 'now' }).click()
  await expect(page.getByTestId('workflow-overview')).toBeVisible()
  await expect(page.getByTestId('moment')).toHaveCount(0)
})

test('says conditions in plain words: a split by its value, other steps in a sentence', async ({ page }) => {
  await page.goto(`${RUN_VIEWER}/`)
  await expect(walkStep(page, 'find the cause').getByTestId('step-note')).toHaveText('bug')
  await expect(walkStep(page, 'document it for users').getByTestId('step-note')).toHaveText('only when kind is feature or user visible is yes')
})

const workItemId = async (page: Page, issue: string) => {
  const project = await servedProject(page, RUN_VIEWER)
  const items = (await (await page.request.get(`${RUN_VIEWER}/api/projects/${project}/work-items`)).json()) as { issue: string; work_item_id: string }[]
  return { project, id: items.find((item) => item.issue === issue)!.work_item_id }
}
const routeStep = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const DELIVERED_2 = 'delivered 20 Nov, 18:56'

test('opens a work item on its route: lit where it went, faded where it skipped, the step-in at the step that should have caught it', async ({ page }) => {
  const { project, id } = await workItemId(page, '#2')
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items/${id}`)
  await expect(page.getByTestId('item-state')).toHaveText(DELIVERED_2)
  await expect(routeStep(page, '2.2 write the spec').getByTestId('stop')).toHaveAttribute('data-reached', 'skipped')
  await expect(routeStep(page, '2.2 write the spec').getByTestId('step-note')).toHaveText('skipped: only when kind is feature')
  await expect(routeStep(page, '4.4 have the change reviewed').getByTestId('reviews-passed')).toHaveText('✓')
  await expect(routeStep(page, '3.1 reproduce the bug with a failing test').getByTestId('friction-ring')).toHaveText('1')
  await expect(page.getByTestId('key')).not.toContainText('sent back')
})

test('drills into a step one level at a time: what happened, then the evidence, then every tool call', async ({ page }) => {
  const { project, id } = await workItemId(page, '#2')
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items/${id}`)
  await routeStep(page, '3.1 reproduce the bug with a failing test').click()
  const detail = page.getByTestId('step-detail')
  await expect(detail).toContainText('you stepped in after delivery')
  await expect(detail).toContainText('why this step should have caught it')
  await expect(detail).toContainText("passed · Agent's own check")
  await expect(detail).not.toContainText('Agent checked rule')
  await detail.getByRole('button', { name: 'the evidence ›' }).click()
  await expect(detail).toContainText('Agent checked rule test 1.2')
  await expect(detail).toContainText('test totals, as the tool printed them')
  await detail.getByRole('button', { name: 'every tool call · 3 ›' }).click()
  await expect(detail.getByTestId('call')).toHaveCount(3)
  await routeStep(page, '3.1 reproduce the bug with a failing test').click()
  await expect(page.getByTestId('step-detail')).toHaveCount(0)
})

test('shows a work item in flight at a past moment: where it is, and what it does there', async ({ page }) => {
  const { project, id } = await workItemId(page, '#5')
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items/${id}?at=${MOCK_MOMENT}`)
  await expect(page.getByTestId('item-state')).toHaveText('in progress at have the change reviewed')
  await expect(page.getByTestId('moment')).toHaveText('20 Nov, 19:10 UTC · workflow 2.1.0')
  await expect(page.getByTestId('here')).toHaveAttribute('data-tip', '#5 is here now')
  await expect(routeStep(page, '4.3 show the bug is fixed').getByTestId('step-note')).toHaveText('skipped: only when kind is bug')
  await routeStep(page, '4.4 have the change reviewed').click()
  await expect(page.getByTestId('step-detail')).toContainText('Agent is working on this step')
})

test('finds a work item by its number from the header, and says when there is none', async ({ page }) => {
  await page.goto(`${RUN_VIEWER}/`)
  const find = page.getByLabel('find a work item by its number')
  await find.fill('2')
  await find.press('Enter')
  await expect(page.getByTestId('item-state')).toHaveText(DELIVERED_2)
  await find.fill('99')
  await find.press('Enter')
  await expect(page.getByText('no #99')).toBeVisible()
})

test('opens work items from the Workflow page: one goes straight to it, several give a short list', async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  await page.getByTestId('workflow-overview').getByTestId('item-box').click()
  await expect(page.getByTestId('item-state')).toHaveText('in progress at have the change reviewed')
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  await page.getByTestId('workflow-overview').getByTestId('friction-ring').click()
  const picker = page.getByTestId('picker')
  await expect(picker.getByRole('menuitem')).toHaveText(['#1', '#2'])
  await picker.getByRole('menuitem', { name: '#2' }).click()
  await expect(page.getByTestId('item-state')).toHaveText(DELIVERED_2)
})

test('lists the work items latest first, with where each is and how often Owner stepped in', async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/items`)
  const rows = page.getByTestId('item-row')
  await expect(rows).toHaveCount(8)
  await expect(rows.first()).toContainText('#8')
  await expect(rows.filter({ hasText: '#2' })).toContainText('totalUnits(rows) in src/summary.js')
  const second = rows.filter({ hasText: '#2' })
  await expect(second).toContainText('1')
  await second.click()
  await expect(page.getByTestId('item-state')).toHaveText(DELIVERED_2)
})

test('lists the changes to the workflow, numbers first, and opens one to why it was made and what it changed', async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow`)
  await page.getByRole('link', { name: 'changes' }).click()
  const changes = page.getByTestId('change')
  await expect(changes).toHaveCount(3)
  await expect(changes.getByTestId('measure')).toHaveText(['0.4→0', '0.67→0.33', '0.67→0.33'])
  await expect(changes.first().getByTestId('measure')).toHaveAttribute('data-tip', /^too early: 2 of 3 work items\. your step-ins per work item: 0\.4 before, 0 over 2 work items since$/)
  await expect(changes.nth(1).getByTestId('measure')).toHaveAttribute('data-tip', /^not proven/)
  await changes.nth(1).getByRole('button').click()
  const detail = page.getByTestId('change-detail')
  await expect(detail).toContainText('Removes the friction from #2')
  await expect(detail).toContainText('changedstep 3.1reproduce the bug with a failing test')
})

test('explains a mark reached with the keyboard', async ({ page }) => {
  const project = await servedProject(page, RUN_VIEWER)
  await page.goto(`${RUN_VIEWER}/#/p/${project}/workflow?at=${MOCK_MOMENT}`)
  await page.getByTestId('workflow-overview').getByTestId('item-box').focus()
  await expect(page.getByTestId('tip')).toHaveText('1 work item here now: #5')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workflow')
})
