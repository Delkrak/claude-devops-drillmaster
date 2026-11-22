import { defineConfig, devices } from '@playwright/test'

// Browser tests of the viewer, against a real Drillmaster server seeded with a real simulation run
// and a synthetic project covering every gate kind. Run `npm run build` first: the server serves
// the built viewer from dist/viewer.
import { VIEWER_PORT } from './test/viewer/port.js'

export default defineConfig({
  testDir: 'test/viewer',
  testMatch: '*.spec.ts',
  globalSetup: './test/viewer/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${VIEWER_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
