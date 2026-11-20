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
