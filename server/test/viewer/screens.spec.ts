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
