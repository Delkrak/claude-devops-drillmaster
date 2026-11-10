import { expect, test } from '@playwright/test'
import { RUN_VIEWER_PORT, VIEWER_PORT } from './port.js'
import { DEMO_DIR } from './global-setup.js'

const RUN_VIEWER = `http://127.0.0.1:${RUN_VIEWER_PORT}/`

test('opens on the one project its server serves, and no other', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByTestId('project-title')).toContainText('gates-demo')
  await expect(page).toHaveURL(/#\/p\/gates-demo-[0-9a-f]+\/overview$/)
  await page.goto(RUN_VIEWER)
  await expect(page.getByTestId('project-title')).toContainText('dm-sim-node-report')
  const runProject = new URL(page.url()).hash.split('/')[2]!
  expect((await request.get(`/api/projects/${runProject}`)).status()).toBe(404)
})

test("navigates from a project's overview through every tab", async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('project-title')).toContainText('gates-demo')
  await expect(page.getByTestId('project-title')).toContainText('gates-demo')
  await expect(page.getByTestId('now')).toContainText('owner gate pending')

  await page.getByRole('tab', { name: 'Workflow' }).click()
  await expect(page).toHaveURL(/#\/p\/.+\/workflow$/)
  await expect(page.getByTestId('stage')).toHaveCount(2)
  await expect(page.getByTestId('step').filter({ hasText: 'describe the PR' })).toContainText('Drillmaster gate')
  await expect(page.getByTestId('experiment')).toContainText('baseline 1.5')
  await expect(page.getByTestId('experiment')).toContainText('Hypothesis: A test step means Owner stops asking for tests')
  await expect(page.getByTestId('experiment')).toContainText('target 0.5')
  await expect(page.getByTestId('stage').first()).toContainText('the change works and says what it does')
  await expect(page.getByTestId('definition-of-done').first()).toContainText('test 1.1 the tests run green before a PR')
  await expect(page.getByTestId('definition-of-done').first()).toContainText('pr 1.1 the PR says what it changes')
  await expect(page.getByTestId('instruction').first()).toContainText('Write a test for the change')
  await expect(page.getByTestId('metric')).toContainText('taken by agent at step 1.1')
  await expect(page.getByTestId('metric-category')).toHaveCount(2)
  await page.getByRole('combobox', { name: 'Workflow version' }).selectOption('0.0.0')
  await expect(page.getByTestId('workflow')).toContainText('No work stages yet')

  await page.getByRole('tab', { name: 'Work items' }).click()
  await expect(page.getByTestId('work-items-table').locator('tbody tr')).toHaveCount(2)

  await page.getByRole('tab', { name: 'Retrospectives' }).click()
  await expect(page.getByTestId('empty')).toContainText('No workflow retrospective yet')

  await page.getByRole('tab', { name: 'Measures' }).click()
  await expect(page.getByTestId('measures')).toContainText('Experiment 1 baseline')
  await expect(page.getByTestId('measure-by-metric').first()).toContainText('By size')
  await expect(page.getByTestId('measure-by-metric').first()).toContainText('small')
})

test("a work item's page shows its gates, post mortems and a searchable added step", async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('project-title')).toContainText('gates-demo')
  await page.getByRole('tab', { name: 'Work items' }).click()
  await page.getByTestId('work-items-table').locator('tbody tr', { hasText: '#1 CSV export' }).click()

  await expect(page.getByTestId('item-title')).toContainText('#1 CSV export')
  await expect(page.getByTestId('description')).toContainText('Owner wants the report as CSV')
  await expect(page.getByTestId('summary')).toContainText('the test checks the header')
  await expect(page.getByTestId('item-metrics')).toContainText('size: small (by agent)')
  const image = page.getByTestId('artifact').locator('img')
  await expect(image).toHaveAttribute('alt', 'after.png')
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1)
  await expect(page.getByTestId('post-mortem-agent')).toContainText('step 1.1the gates')
  await expect(page.getByTestId('post-mortem-agent').getByTestId('feedback-ref')).toHaveText(['step 1.1', 'tool work_deliver'])
  await expect(page.getByTestId('post-mortem-agent')).toContainText('#1: experiment 1 helped')
  await expect(page.getByTestId('post-mortem-drillmaster')).toContainText('Ask for CHANGES.md in a rule')
  await expect(page.getByTestId('verdict').filter({ hasText: 'rejected by drillmaster' })).toBeVisible()
  await expect(page.getByTestId('verdict').filter({ hasText: 'accepted by owner' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search the timeline' }).fill('added_step')
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1)
  await expect(page.getByTestId('report-added_step')).toBeVisible()
  await expect(page.getByTestId('timeline')).toContainText('you forgot CHANGES.md')

  await page.getByRole('searchbox', { name: 'Search the timeline' }).fill('')
  const all = await page.getByTestId('timeline-entry').count()
  await page.getByRole('button', { name: /^actions/ }).click()
  await expect(page.getByTestId('timeline-entry')).not.toHaveCount(all)
  await page.getByRole('link', { name: 'Work items' }).click()
  await expect(page.getByTestId('work-items-table')).toBeVisible()
})

test('shows a real simulated run: its retrospective, applied proposals and measures', async ({ page }) => {
  await page.goto(RUN_VIEWER)
  await page.getByRole('tab', { name: 'Retrospectives' }).click()
  await expect(page.getByTestId('proposal').first()).toContainText('applied')
  await page.getByRole('tab', { name: 'Work items' }).click()
  await expect(page.getByTestId('work-items-table').locator('tbody tr')).toHaveCount(3)
  await page.getByRole('tab', { name: 'Measures' }).click()
  await expect(page.getByRole('img', { name: 'owner_corrections_per_item per work item' })).toBeVisible()
})

test('follows a live session: a new work item appears without reloading', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByTestId('project-title')).toContainText('gates-demo')
  await page.getByRole('tab', { name: 'Work items' }).click()
  await expect(page.getByTestId('work-items-table').locator('tbody tr')).toHaveCount(2)
  await request.post(`http://127.0.0.1:${VIEWER_PORT}/tools/call`, { data: { project: DEMO_DIR, name: 'work_start', arguments: { issue: '#3 live', description: 'started while the viewer is open' } } })
  await expect(page.getByTestId('work-items-table').locator('tbody tr', { hasText: '#3 live' })).toBeVisible({ timeout: 10_000 })
})

test('follows the dark theme from the tokens', async ({ browser }) => {
  const background = async (colorScheme: 'light' | 'dark') => {
    const page = await browser.newPage({ colorScheme })
    await page.goto('/')
    await expect(page.getByTestId('project-title')).toBeVisible()
    const color = await page.getByRole('main').evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)
    await page.close()
    return color
  }
  expect(await background('light')).not.toBe(await background('dark'))
})
