/**
 * Playwright e2e test configuration.
 *
 * Tests launch a real Electron process pointing at the built `out/main/index.js`.
 * Run `npm run build` before `npm run test:e2e` to refresh the build.
 *
 * Key design choices:
 *  - Each test gets its own temp userData dir (--user-data-dir) so tests are isolated.
 *  - A local HTTP mock server stands in for real AI websites, so no network required.
 *  - AUTOAI_PROBE_DELAY is set to 800ms (vs 5000ms in production) to keep tests fast.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,          // per-test timeout
  expect: { timeout: 8000 }, // assertion timeout
  fullyParallel: false,      // Electron windows interfere if run in parallel
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    trace: 'retain-on-failure',
  },
})
