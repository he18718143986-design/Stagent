/**
 * GUI recording spec for ExecutionQualityBar: neutral during execution → delivery complete.
 * Uses workflow-aware mock LLM (no real API balance required).
 */
import { test, expect } from './fixtures/electron-app'
import { seedMockSite } from './helpers/seed-store'
import { seedStagentDirectApi } from './helpers/seed-stagent'
import { startMockLlmServer, type MockLlmServer } from './helpers/mock-llm-server'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function seedPlanningGatesOff(userDataDir: string): void {
  const configPath = join(userDataDir, 'stagent', 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
  config['plan.requireCompleteness'] = false
  config['hitl.pauseContractNodes'] = false
  config['tdd.redGreenGate'] = 'off'
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

const TASK =
  '读取本地 input.csv，统计 status=active 的行数与金额合计，写出 summary.json。需要 reader.py + main.py，Python 实现。'

test.use({
  video: 'on',
  launchOptions: {
    slowMo: 800,
  },
})

test('quality bar GUI: execution neutral → partial steps → delivery', async ({ launchApp, userDataDir }) => {
  test.setTimeout(120_000)

  let llm: MockLlmServer | undefined
  try {
    llm = await startMockLlmServer()
    seedMockSite(userDataDir, 'http://127.0.0.1:1/unused')
    const { workspacePath } = seedStagentDirectApi(userDataDir, llm.url)
    seedPlanningGatesOff(userDataDir)

    const { page } = await launchApp()

    await page.getByRole('button', { name: '工作流' }).click()
    await expect(page.getByText('想做点什么')).toBeVisible({ timeout: 15_000 })

    await page.getByPlaceholder(/比如/).fill(TASK)
    // IntakeChatScreen uses native folder picker; drive generation via direct API with seeded workspace.
    await page.evaluate(
      async ({ userInput, workspacePath: ws }) => {
        const r = await window.autoAI.stagent.send({
          type: 'generateWorkflow',
          userInput,
          taskType: 'prototype',
          taskWorkspacePath: ws,
        })
        if (!r.ok) throw new Error(r.error ?? 'generateWorkflow failed')
      },
      { userInput: TASK, workspacePath },
    )

    const startBtn = page.getByRole('button', { name: /看起来不错|批准并开始/ })
    await expect(startBtn).toBeVisible({ timeout: 20_000 })
    await expect(startBtn).toBeEnabled({ timeout: 10_000 })
    await startBtn.click()
    await page.getByRole('button', { name: '确认，开始制作' }).click()

    // ── State 1: 执行中 — neutral quality bar (no report yet) ──
    const qualityBar = page.getByRole('status', { name: /质量/ })
    await expect(qualityBar).toBeVisible({ timeout: 15_000 })
    await expect(qualityBar).toContainText(/尚未生成|尚无逐阶段测试/)
    await page.waitForTimeout(2_000)

    // ── State 2: 部分进展 — stages completing, bar still neutral ──
    await expect(page.getByText(/✓ 完成/).first()).toBeVisible({ timeout: 30_000 })
    await expect(qualityBar).toContainText(/尚未生成|尚无逐阶段测试/)
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/quality-bar-execution-neutral.png' })
    await page.waitForTimeout(3_000)

    // Confidence pause gate (mock workflow may pause after high-confidence stages)
    const continueBtn = page.getByRole('button', { name: '确认并继续' })
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click()
    }

    // ── State 3: 完成 — delivery screen (may show partial AFK concern) ──
    await expect(page.getByText(/做好了|做完了/)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('验收报告')).toBeVisible()
    await page.getByRole('tab', { name: '复盘' }).click()
    await page.getByRole('tab', { name: '成果' }).click()
    await page.getByRole('tab', { name: '验收' }).click()
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/quality-bar-delivery-final.png' })
  } finally {
    if (llm) await llm.close()
  }
})
