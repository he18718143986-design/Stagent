/* ------------------------------------------------------------------ */
/*  src/main/index.ts — Electron main process entry point             */
/* ------------------------------------------------------------------ */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'
import { SiteStore } from './site-store'
import { BrowserViewManager } from './browser-view'
import { registerSiteIpc, registerChatIpc, registerCalibrateIpc, registerStatusIpc, registerChatModelIpc, probeAllSites } from './ipc'
import { networkDiagnosticsSnapshot, runProxyConsistencyCheck } from './network-diagnostics'
import { startLocalAdapterServer } from './adapter/local-adapter'
import { registerStagentIpc, STAGENT_IPC_CHANNELS } from './stagent/stagent-ipc'
import { focusExistingWindow } from './single-instance'

const ENABLE_AUTOMATION_CDP =
  (process.env['AUTOAI_AUTOMATION_MODE'] || '').toLowerCase() === 'playwright'
  || Boolean((process.env['AUTOAI_PLAYWRIGHT_HOSTS'] || '').trim())
  || Boolean((process.env['AUTOAI_ENABLE_CDP'] || '').trim())

if (ENABLE_AUTOMATION_CDP) {
  const p = (process.env['AUTOAI_CDP_PORT'] || '9223').trim()
  app.commandLine.appendSwitch('remote-debugging-port', p)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

log.initialize()
log.info('autoAI starting', {
  version: app.getVersion(),
  pid: process.pid,
  automationCdp: ENABLE_AUTOMATION_CDP,
})

// ─── Single-instance lock ───────────────────────────────────────────────────
// macOS refuses to open a second copy of the same app bundle ("应用程序
// 'Electron' 已不能再打开"), and two instances would clash on the local adapter
// port. Hold a single-instance lock: a second launch focuses the existing
// window instead. Disabled under tests (NODE_ENV=test) so each E2E run — which
// uses its own isolated userData — is never blocked.
const isTestEnv = process.env['NODE_ENV'] === 'test'
const hasSingleInstanceLock = isTestEnv ? true : app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  log.info('single-instance: another instance is already running — quitting this one')
  app.quit()
} else if (!isTestEnv) {
  app.on('second-instance', () => {
    log.info('single-instance: second launch detected — focusing existing window')
    focusExistingWindow(mainWindow)
  })
}

// ─── Proxy support (environment-driven) ─────────────────────────────────────

function parseProxyUrl(raw: string): { server: string; username?: string; password?: string } {
  try {
    const u = new URL(raw)
    const username = decodeURIComponent(u.username) || undefined
    const password = decodeURIComponent(u.password) || undefined
    // Chromium's --proxy-server expects scheme://host:port (no inline credentials)
    u.username = ''
    u.password = ''
    return { server: u.toString().replace(/\/$/, ''), username, password }
  } catch {
    return { server: raw }
  }
}

const PROXY_URL = process.env['HTTPS_PROXY'] || process.env['https_proxy']
  || process.env['HTTP_PROXY'] || process.env['http_proxy'] || ''

let proxyCredentials: { username?: string; password?: string } = {}

if (PROXY_URL) {
  const parsed = parseProxyUrl(PROXY_URL)
  proxyCredentials = { username: parsed.username, password: parsed.password }
  app.commandLine.appendSwitch('proxy-server', parsed.server)
  // Keep localhost traffic direct (renderer dev server, local APIs, etc.)
  app.commandLine.appendSwitch('proxy-bypass-list', '127.0.0.1;localhost;<local>')
  // Prevent WebRTC from leaking direct network path outside proxy
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')
  log.info('proxy configured', { server: parsed.server, hasAuth: !!parsed.username })
}

// ─── Singletons ─────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let siteStore: SiteStore | null = null
let bvm: BrowserViewManager | null = null
let adapterControl: ReturnType<typeof startLocalAdapterServer> | null = null

// ─── Window management ──────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset', // macOS: traffic lights + no title bar
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('resize', () => {
    bvm?.onWindowResize()
  })

  // Open external links in default browser, not in the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  log.info('Main window created')
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

/**
 * All IPC channels registered by this app.
 * Must be kept in sync with the ipcMain.handle() calls in ipc.ts.
 * Used by unregisterIpc() so we can safely re-register on macOS re-activation.
 */
const IPC_CHANNELS = [
  'ping',
  'site:add', 'site:remove', 'site:list',
  'site:open-login', 'site:close-login', 'site:close-all-logins',
  'site:update-selectors', 'site:rename', 'site:show-view', 'site:hide-view',
  'site:check-quota',
  'site:get-network-diagnostics',
  'site:refresh-network-diagnostics',
  'site:get-last-chat-failure',
  'site:list-recent-chat-failures',
  'site:clear-chat-failures',
  'site:get-automation-metrics',
  'site:reset-automation-metrics',
  'site:get-runtime-policy',
  'site:set-runtime-policy',
  'site:get-runtime-stats',
  'site:clear-runtime-stats',
  'chat:send', 'chat:switch-model', 'chat:list-models',
  'chat:list-tools', 'chat:toggle-tool',
  'adapter:get-info',
  'calibrate:start', 'calibrate:cancel',
] as const

function unregisterIpc(): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  for (const channel of STAGENT_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
}

/**
 * (Re-)initialises BVM + IPC for a given BrowserWindow.
 * Called both at first launch and when macOS re-activates from the Dock
 * after all windows were closed.
 */
function initForWindow(win: BrowserWindow): void {
  // Create a fresh BrowserViewManager bound to the new window.
  // The callback persists loginActive changes to site-store.json so that
  // the connected state survives Dock re-activation (TA-05 fix).
  bvm = new BrowserViewManager(win, (siteId, active) => {
    siteStore!.setConnected(siteId, active)
  }, (runtimeEvent) => {
    if (!win.isDestroyed()) win.webContents.send('site:runtime-event', runtimeEvent)
  })

  // Restore a background WebContentsView for every stored site.
  // Pass config.connected as the initial loginActive so ChatPage renders
  // the correct status immediately — without waiting for probe (TA-05).
  for (const config of siteStore!.list()) {
    bvm.ensure(config.siteId, config.url, config.connected ?? false)
    log.info('startup: restored background view', {
      siteId: config.siteId,
      hostname: config.hostname,
      initialLoginActive: config.connected ?? false,
    })
  }
  void runProxyConsistencyCheck(siteStore!, { app, proxyUrlEnv: PROXY_URL })

  // Remove any stale IPC handlers from a previous window before re-registering.
  // ipcMain.removeHandler() is a no-op for channels that are not registered,
  // so it is safe to call unconditionally.
  unregisterIpc()
  registerIpc()

  // M6: background startup login probe (non-blocking)
  probeAllSites(win, siteStore!, bvm).catch((err) => {
    log.warn('startup probe error', { err: String(err) })
  })
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  createWindow()

  // Initialise store once — it outlives individual windows.
  siteStore = new SiteStore(app.getPath('userData'))

  initForWindow(mainWindow!)
  adapterControl = startLocalAdapterServer(mainWindow!, siteStore!, bvm!)

  app.on('activate', () => {
    // macOS: re-open window when user clicks Dock icon after all windows closed.
    // Must re-create BVM and re-register IPC so handlers point to the new window.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      initForWindow(mainWindow!)
      adapterControl = startLocalAdapterServer(mainWindow!, siteStore!, bvm!)
    }
  })
})

// Handle proxy authentication (HTTP 407) when proxy URL carries credentials.
app.on('login', (event, _webContents, _request, authInfo, callback) => {
  if (authInfo.isProxy && proxyCredentials.username) {
    event.preventDefault()
    callback(proxyCredentials.username, proxyCredentials.password ?? '')
  }
})

app.on('window-all-closed', () => {
  void adapterControl?.close().catch(() => {})
  adapterControl = null
  bvm?.destroyAll()
  // Null out both refs so initForWindow() creates fresh objects on re-activation.
  bvm = null
  mainWindow = null
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC handlers ───────────────────────────────────────────────────────────

function registerIpc(): void {
  // M1 verification: round-trip IPC test
  ipcMain.handle('ping', () => {
    log.info('ping received')
    return 'pong'
  })

  // M2: site management IPC
  registerSiteIpc(mainWindow!, siteStore!, bvm!, {
    getSnapshot: () => networkDiagnosticsSnapshot,
    refresh: async () => runProxyConsistencyCheck(siteStore!, { app, proxyUrlEnv: PROXY_URL }),
  })
  // M3: chat send IPC
  registerChatIpc(mainWindow!, siteStore!, bvm!)
  // M5: calibration IPC
  registerCalibrateIpc(mainWindow!, siteStore!, bvm!)
  // M6: site:check-quota IPC
  registerStatusIpc(mainWindow!, siteStore!, bvm!)
  // M11: model switching IPC
  registerChatModelIpc(mainWindow!, siteStore!, bvm!)
  ipcMain.handle('adapter:get-info', () => adapterControl?.getInfo() ?? { enabled: false, url: '' })
  // Stagent: 决策式工作流引擎（复用 @stagent/core，宿主能力由 ElectronPlatformAdapter 提供）
  // 第三参注入本地 :8787 适配器信息，使 LLM 提供方链可「真实 API 优先、本地降级」。
  registerStagentIpc(
    () => mainWindow ?? undefined,
    app.getPath('userData'),
    () => adapterControl?.getInfo() ?? { enabled: false, url: '' },
  )
}
