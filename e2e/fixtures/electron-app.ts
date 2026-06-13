/**
 * Reusable Playwright fixture that provides an isolated userData directory and
 * a lazy `launchApp()` function.
 *
 * Usage pattern — always seed BEFORE launching:
 *
 *   import { test, expect } from '../fixtures/electron-app'
 *   test('...', async ({ launchApp, userDataDir }) => {
 *     seedMockSite(userDataDir, url)        // seed FIRST
 *     const { page } = await launchApp()   // then launch
 *     await expect(page.getByText('...')).toBeVisible()
 *   })
 *
 * IMPORTANT — firstWindow() pitfall with Electron 30 WebContentsViews:
 *   When background WebContentsViews (for AI sites) are created at startup,
 *   Playwright may return one of those views instead of the main BrowserWindow.
 *   We detect the correct page by checking for `window.autoAI` which is only
 *   injected by the preload script into the main BrowserWindow.
 */
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type { ElectronApplication, Page }

export interface LaunchResult {
  app: ElectronApplication
  page: Page
}

export interface ElectronFixtures {
  /** Isolated temp directory used as Electron userData for this test */
  userDataDir: string
  /**
   * Launch the Electron app.  Call this AFTER seeding userDataDir so that the
   * app sees the pre-populated store on startup.  The app is closed
   * automatically when the test finishes.
   */
  launchApp: () => Promise<LaunchResult>
}

/**
 * Finds the main BrowserWindow page by checking for window.autoAI (preload marker).
 * Background WebContentsViews load AI sites and do NOT have the preload script.
 */
async function findMainPage(app: ElectronApplication): Promise<Page> {
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const win of app.windows()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasPreload = await win.evaluate(() => typeof (window as any).autoAI !== 'undefined')
        if (hasPreload) return win
      } catch {
        // Page not ready yet — try next
      }
    }
    await new Promise<void>((r) => setTimeout(r, 200))
  }
  return app.firstWindow() // fallback
}

export const test = base.extend<ElectronFixtures>({
  // ── 1. Isolated temp userData dir ────────────────────────────────────────
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'autoai-e2e-'))
    mkdirSync(dir, { recursive: true })
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },

  // ── 2. Lazy app launcher ──────────────────────────────────────────────────
  launchApp: async ({ userDataDir }, use) => {
    let launched: ElectronApplication | null = null

    await use(async (): Promise<LaunchResult> => {
      launched = await electron.launch({
        args: [
          join(__dirname, '../../out/main/index.js'),
          `--user-data-dir=${userDataDir}`,
          '--disable-gpu',
          '--no-sandbox',
        ],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          // Shorten startup probe delay (default 5 s → 800 ms in tests)
          AUTOAI_PROBE_DELAY: '800',
        },
      })

      // Ensure at least one window has loaded before searching
      await launched.firstWindow()
      // Find the MAIN BrowserWindow (has preload → window.autoAI)
      // not a background WebContentsView (AI site, no preload)
      const page = await findMainPage(launched)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(300)
      return { app: launched, page }
    })

    // Always close — even if the test threw
    if (launched) await (launched as ElectronApplication).close().catch(() => {})
  },
})

export { expect } from '@playwright/test'
