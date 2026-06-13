/**
 * End-to-end Stagent prototype workflow against a workflow-aware mock LLM.
 *
 * Drives the real Electron host + @stagent/core engine (no real AI accounts):
 *   1. mock LLM returns a prototype plan (requirements + writer + main, all
 *      llm-text → no python, no decision HITL) for the generation call;
 *   2. each stage call returns canned output by sentinel marker.
 *
 * Asserts the two behaviours from the recent core changes:
 *   - Delivery closure (#1): the confirmed plan includes the writer + main
 *     stages (does not stop at an intermediate module).
 *   - requirements.txt no false pause (#4): the requirements impl stage scores
 *     HIGH confidence and the workflow runs to completion with NO confidence
 *     pause ("确认并继续") — pre-fix it scored 0.28/critical and blocked here.
 */
import { test, expect } from './fixtures/electron-app'
import { seedMockSite } from './helpers/seed-store'
import { seedStagentDirectApi } from './helpers/seed-stagent'
import { startMockLlmServer, type MockLlmServer } from './helpers/mock-llm-server'

const REQUIREMENTS_TITLE = '生成 requirements.txt 依赖清单'
const WRITER_TITLE = '实现 writer.py（产出 CSV 交付物）'
const MAIN_TITLE = '实现 main.py（串联流程并写出交付物）'
const HIGH_CONFIDENCE = /置信 (7[5-9]|[89][0-9]|100)%/

test('prototype workflow: delivery closure plan + requirements.txt runs without a false confidence pause', async ({
  launchApp,
  userDataDir,
}) => {
  let llm: MockLlmServer | undefined
  try {
    llm = await startMockLlmServer()

    // Seed BEFORE launch: a site (skip onboarding) + Stagent direct-API config.
    seedMockSite(userDataDir, 'http://127.0.0.1:1/unused')
    const { workspacePath } = seedStagentDirectApi(userDataDir, llm.url)

    const { page } = await launchApp()

    // App starts on ChatPage → open the 工作流 (Stagent) page.
    await page.getByRole('button', { name: '工作流' }).click()
    await expect(page.getByRole('heading', { name: '新建决策式工作流' })).toBeVisible()

    // Fill the task + workspace, then generate.
    await page
      .getByPlaceholder(/描述你想完成的任务/)
      .fill('读取本地 input.xlsx，抓取线上价格库存并对比，导出 diff 结果 CSV')
    await page.getByPlaceholder(/绝对路径/).fill(workspacePath)
    await page.getByRole('button', { name: '生成工作流' }).click()

    // ── Confirm phase: delivery closure (#1) — writer + main present ──────────
    const startBtn = page.getByRole('button', { name: '开始执行' })
    await expect(startBtn).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(REQUIREMENTS_TITLE)).toBeVisible()
    await expect(page.getByText(WRITER_TITLE)).toBeVisible()
    await expect(page.getByText(MAIN_TITLE)).toBeVisible()
    // Not hard-blocked by the generation gate.
    await expect(startBtn).toBeEnabled()

    // ── Execute ──────────────────────────────────────────────────────────────
    await startBtn.click()

    // Workflow runs to completion — proves no stage stalled on a pause.
    await expect(page.getByText('✓ 工作流已完成')).toBeVisible({ timeout: 30_000 })

    // #4: requirements.txt stage scored HIGH confidence and did NOT pause.
    const reqCard = page.locator('div.border-gray-200', { hasText: REQUIREMENTS_TITLE })
    await expect(reqCard).toContainText('已完成')
    await expect(reqCard).toContainText(HIGH_CONFIDENCE)

    // No confidence pause anywhere in the run.
    await expect(page.getByRole('button', { name: '确认并继续' })).toHaveCount(0)
  } finally {
    if (llm) await llm.close()
  }
})
