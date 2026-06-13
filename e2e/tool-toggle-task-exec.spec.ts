/**
 * e2e/tool-toggle-task-exec.spec.ts
 *
 * Locks the M12 chain: "task execution auto-enables activeTools before send".
 *
 *   local adapter  /v1/chat/completions
 *        → pickSiteForModel(siteId)
 *        → ensureActiveTools()   ← clicks the tool toggle ON
 *        → dispatchChatSend()    ← sends the prompt
 *
 * The mock site (mock-site.ts) has a fake "深度思考" button whose state is
 * reflected by aria-pressed, and its echo embeds the tool state captured AT
 * SEND TIME ("[deepThink=on|off]"). So the HTTP response content proves whether
 * ensureActiveTools flipped the toggle before the prompt was dispatched.
 *
 * Two cases:
 *   • activeTools = ['deepThink']  → echo must contain [deepThink=on]
 *   • activeTools = []             → echo must contain [deepThink=off]  (control)
 *
 * IMPORTANT: seed the userData dir BEFORE launchApp().
 */
import { test, expect } from './fixtures/electron-app'
import { seedMockSite } from './helpers/seed-store'
import { startMockServer } from './helpers/mock-site'

const SITE_ID = 'aaaaaaaa-0000-0000-0000-0000000000c1'

const DEEP_THINK_TOGGLE = {
  id: 'deepThink',
  label: '深度思考',
  selector: '#ai-tool-deepthink',
}

// M13: mock model picker — matches the fake #ai-model-btn menu in mock-site.ts.
const MODEL_SWITCHER = '#ai-model-btn'
const AVAILABLE_MODELS = [
  { id: 'm-fast', label: 'Fast', selector: '[data-model="m-fast"]' },
  { id: 'm-pro', label: 'Pro', selector: '[data-model="m-pro"]' },
]

// M13: mock effort submenu — the "Effort" trigger + level buttons in mock-site.ts.
const EFFORT_TRIGGER = 'text=Effort'
const EFFORT_LEVELS = [
  { id: 'low', label: 'Low', selector: '[data-effort="low"]' },
  { id: 'medium', label: 'Medium', selector: '[data-effort="medium"]' },
  { id: 'high', label: 'High', selector: '[data-effort="high"]' },
  { id: 'max', label: 'Max', selector: '[data-effort="max"]' },
]

interface AdapterInfo {
  enabled: boolean
  url: string
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

async function postToAdapter(baseUrl: string, model: string, text: string): Promise<ChatCompletion> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
  })
  return (await res.json()) as ChatCompletion
}

test('task exec: activeTools is auto-enabled before the prompt is sent', async ({
  launchApp,
  userDataDir,
}) => {
  // Unique adapter port so this app's local adapter never collides with another
  // worker's app (which uses the default 8787).
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      toolToggles: [DEEP_THINK_TOGGLE],
      activeTools: ['deepThink'], // user wants 深度思考 ON for task execution
    })
    const { page } = await launchApp()

    // Let the background WebContentsView load the mock page.
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    const completion = await postToAdapter(info.url, SITE_ID, 'hi from e2e')
    const content = completion.choices?.[0]?.message?.content ?? ''

    // The echo captured the toggle state at send time. ON proves the local
    // adapter ran ensureActiveTools() (clicking the toggle) BEFORE dispatch.
    expect(content, `adapter response: ${JSON.stringify(completion)}`).toContain('[deepThink=on]')
    expect(content).toContain('Echo: hi from e2e')
  } finally {
    await server.close()
  }
})

test('task exec: control — no activeTools leaves the tool OFF', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      toolToggles: [DEEP_THINK_TOGGLE],
      // activeTools intentionally omitted — nothing should be auto-enabled.
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    const completion = await postToAdapter(info.url, SITE_ID, 'hi from e2e')
    const content = completion.choices?.[0]?.message?.content ?? ''

    expect(content, `adapter response: ${JSON.stringify(completion)}`).toContain('[deepThink=off]')
  } finally {
    await server.close()
  }
})

test('interactive chat: clicking the ChatPage chip toggles the tool on then off', async ({
  launchApp,
  userDataDir,
}) => {
  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      toolToggles: [DEEP_THINK_TOGGLE],
      // No activeTools → the chip starts OFF.
    })
    const { page } = await launchApp()

    // Wait for the startup probe to mark the mock site connected so ChatPage
    // renders the composer (and therefore the tool chips).
    await page.waitForTimeout(2500)

    // The chip is a button whose accessible name contains the tool label.
    const chip = page.getByRole('button', { name: /深度思考/ })
    await expect(chip).toBeVisible({ timeout: 8000 })

    // Starts OFF.
    await expect(chip).toHaveAttribute('aria-pressed', 'false')

    // Click → chat:toggle-tool(enable=true) → applyToolToggle clicks the page
    // control → activeTools persisted → ChatPage refreshes → chip flips ON.
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 })

    // Click again → enable=false → flips OFF.
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 })
  } finally {
    await server.close()
  }
})

test('resource pool: a site×model×tool spec switches the model AND enables the tool before send', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      modelSwitcherSelector: MODEL_SWITCHER,
      availableModels: AVAILABLE_MODELS,
      toolToggles: [DEEP_THINK_TOGGLE],
      // No defaults — everything comes from the virtual model spec.
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    // Virtual model id encodes: this site, model variant "m-pro", tool "deepThink".
    const spec = `${SITE_ID}::model=m-pro::tool=deepThink`
    const completion = await postToAdapter(info.url, spec, 'hi from e2e')
    const content = completion.choices?.[0]?.message?.content ?? ''

    // Mock default model is m-fast; m-pro proves the model switch fired.
    // deepThink=on proves the tool was enabled — both BEFORE the prompt was sent.
    expect(content, `adapter response: ${JSON.stringify(completion)}`).toContain('[model=m-pro]')
    expect(content).toContain('[deepThink=on]')
  } finally {
    await server.close()
  }
})

test('resource pool: /v1/models expands a site into model + tool variants', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      modelSwitcherSelector: MODEL_SWITCHER,
      availableModels: AVAILABLE_MODELS,
      toolToggles: [DEEP_THINK_TOGGLE],
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo

    const res = await fetch(`${info.url}/v1/models`)
    const body = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (body.data ?? []).map((m) => m.id)

    expect(ids).toContain(SITE_ID) // base
    expect(ids).toContain(`${SITE_ID}::model=m-pro`)
    expect(ids).toContain(`${SITE_ID}::model=m-fast`)
    expect(ids).toContain(`${SITE_ID}::tool=deepThink`)
  } finally {
    await server.close()
  }
})

test('resource pool: an ::effort=high spec sets the reasoning tier before send', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      modelSwitcherSelector: MODEL_SWITCHER,
      availableModels: AVAILABLE_MODELS,
      effortLevels: EFFORT_LEVELS,
      effortMenuTriggerSelector: EFFORT_TRIGGER,
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    // Mock default effort is 'low'; requesting 'high' must drive the submenu.
    const completion = await postToAdapter(info.url, `${SITE_ID}::effort=high`, 'hi from e2e')
    const content = completion.choices?.[0]?.message?.content ?? ''

    expect(content, `adapter response: ${JSON.stringify(completion)}`).toContain('[effort=high]')
    expect(content).toContain('Echo: hi from e2e')
  } finally {
    await server.close()
  }
})

test('resource pool: a model+effort+tool spec applies all three before send', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      modelSwitcherSelector: MODEL_SWITCHER,
      availableModels: AVAILABLE_MODELS,
      effortLevels: EFFORT_LEVELS,
      effortMenuTriggerSelector: EFFORT_TRIGGER,
      toolToggles: [DEEP_THINK_TOGGLE],
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo
    expect(info.enabled).toBe(true)

    const spec = `${SITE_ID}::model=m-pro::effort=max::tool=deepThink`
    const completion = await postToAdapter(info.url, spec, 'hi from e2e')
    const content = completion.choices?.[0]?.message?.content ?? ''

    expect(content, `adapter response: ${JSON.stringify(completion)}`).toContain('[model=m-pro]')
    expect(content).toContain('[effort=max]')
    expect(content).toContain('[deepThink=on]')
  } finally {
    await server.close()
  }
})

test('resource pool: /v1/models expands a site into effort variants', async ({
  launchApp,
  userDataDir,
}) => {
  process.env['AUTOAI_ADAPTER_PORT'] = '8798'

  const server = await startMockServer()
  try {
    seedMockSite(userDataDir, server.url, {
      siteId: SITE_ID,
      label: 'ToolBot',
      modelSwitcherSelector: MODEL_SWITCHER,
      availableModels: AVAILABLE_MODELS,
      effortLevels: EFFORT_LEVELS,
      effortMenuTriggerSelector: EFFORT_TRIGGER,
    })
    const { page } = await launchApp()
    await page.waitForTimeout(2500)

    const info = (await page.evaluate(
      // @ts-expect-error window.autoAI is injected by the preload script
      () => window.autoAI.adapter.getInfo(),
    )) as AdapterInfo

    const res = await fetch(`${info.url}/v1/models`)
    const body = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (body.data ?? []).map((m) => m.id)

    expect(ids).toContain(`${SITE_ID}::effort=high`)
    expect(ids).toContain(`${SITE_ID}::effort=max`)
  } finally {
    await server.close()
  }
})
