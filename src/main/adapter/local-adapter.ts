import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { listenWithPortFallback } from './listen-port'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import type { SiteStore, SiteConfig } from '../site-store'
import type { BrowserViewManager } from '../browser-view'
import { dispatchChatSend } from '../automation/chat-dispatcher'
import { ensureToolsEnabled } from '../automation/tool-toggle'
import { applyModelSwitch, applyEffort } from '../automation/model-switch'
import { waitAdapterSettled } from '../automation/adapter-events'
import { getLastChatFailure } from '../chat-failure-log'
import {
  parseModelSpec,
  pickSiteForModel,
  expandPool,
  isPoolGroupSpec,
  resolvePoolGroup,
  poolGroupToConcrete,
  type ParsedModelSpec,
} from './model-pool'

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionRequest {
  model: string
  messages: OpenAIMessage[]
  stream?: boolean
}

export function startLocalAdapterServer(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): { close: () => Promise<void>; getInfo: () => { enabled: boolean; url: string } } {
  const enabled = (process.env['AUTOAI_ADAPTER_ENABLE'] ?? '1') !== '0'
  const port = parseInt(process.env['AUTOAI_ADAPTER_PORT'] ?? '8787', 10)
  const host = process.env['AUTOAI_ADAPTER_HOST'] ?? '127.0.0.1'
  const urlFor = (p: number): string => `http://${host}:${p}`
  // Actual bound port — may differ from `port` when it falls back on EADDRINUSE.
  let actualPort = port
  const baseUrl = urlFor(port)
  if (!enabled) {
    return {
      close: async () => {},
      getInfo: () => ({ enabled: false, url: baseUrl }),
    }
  }

  const server = createServer(async (req, res) => {
    if (!req.url) return writeJson(res, 404, { error: 'not-found' })
    if (req.method === 'GET' && req.url === '/health') {
      return writeJson(res, 200, { ok: true, service: 'autoai-local-adapter', url: baseUrl })
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      // M13: expand each site into site × model variant × tool entries so the
      // stagent control panel can pick a fine-grained "resource" directly.
      const models = expandPool(store.list()).map((e) => ({
        id: e.id,
        object: 'model',
        created: Math.floor(e.createdAt / 1000),
        owned_by: e.hostname,
        metadata: { siteId: e.siteId, label: e.label },
      }))
      return writeJson(res, 200, { object: 'list', data: models })
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      try {
        const body = await readJson<ChatCompletionRequest>(req)
        const userText = buildPromptText(body.messages)
        if (!userText) return writeJson(res, 400, { error: { message: 'messages must include user content' } })

        const deps = { win, store, bvm }

        // 缺口2: cross-account pool group (任一账号·自动轮转). Try the hostname's
        // accounts in order (non-exhausted first), skipping exhausted ones and
        // rotating past any that hit their quota mid-send. First success wins.
        if (isPoolGroupSpec(body.model)) {
          const candidates = resolvePoolGroup(store.list(), body.model)
          if (!candidates.length) {
            return writeJson(res, 404, { error: { message: `no account for pool: ${body.model}` } })
          }
          let sawError: { status: number; message: string; siteId: string } | undefined
          for (const site of candidates) {
            if (site.quotaExhausted) continue
            const spec = parseModelSpec(poolGroupToConcrete(site, body.model))
            const r = await sendViaSite(deps, site, spec, userText)
            if (r.kind === 'quota') continue
            if (r.kind === 'error') {
              log.info('adapter: pool member errored, trying next', {
                siteId: site.siteId,
                status: r.status,
                message: r.message,
              })
              sawError = { status: r.status, message: r.message, siteId: site.siteId }
              continue
            }
            return writeJson(res, 200, buildCompletion(body.model, r.sendSeq, r.text, site.siteId))
          }
          // No account succeeded. If the only reason was quota → 429; otherwise
          // surface the last hard error.
          if (sawError) {
            return writeJson(res, sawError.status, {
              error: { message: sawError.message, siteId: sawError.siteId, failure: getLastChatFailure() },
            })
          }
          return writeJson(res, 429, {
            error: { message: `all accounts exhausted for pool: ${body.model}`, code: 'quota_exhausted' },
          })
        }

        // Concrete account spec.
        const site = pickSiteForModel(store.list(), body.model)
        if (!site) return writeJson(res, 404, { error: { message: `model/site not found: ${body.model}` } })

        // M14(缺口1): a known-exhausted account fast-fails with 429 so the
        // provider chain skips it (cooldown + failover) without wasting a full
        // send + 130s settle wait. The flag is cleared by the page re-probe
        // (ipc.ts clearQuotaIfRecovered) once quota recovers.
        if (site.quotaExhausted) {
          return writeJson(res, 429, {
            error: { message: `quota exhausted: ${site.siteId}`, code: 'quota_exhausted', siteId: site.siteId },
          })
        }

        const r = await sendViaSite(deps, site, parseModelSpec(body.model), userText)
        if (r.kind === 'quota') {
          // M14(缺口1): quota detected during/after this send → 429 so the chain
          // cools this account down and rotates to the next provider.
          return writeJson(res, 429, {
            error: { message: `quota exhausted: ${site.siteId}`, code: 'quota_exhausted', siteId: site.siteId },
          })
        }
        if (r.kind === 'error') {
          return writeJson(res, r.status, {
            error: { message: r.message, siteId: site.siteId, failure: getLastChatFailure() },
          })
        }
        return writeJson(res, 200, buildCompletion(body.model, r.sendSeq, r.text, site.siteId))
      } catch (err) {
        return writeJson(res, 400, { error: { message: String(err) } })
      }
    }
    return writeJson(res, 404, { error: 'not-found' })
  })

  // Bind with port fallback: if the requested port is taken (e.g. a second
  // instance), try the next ones instead of crashing. getInfo() reflects the
  // actual bound port so the provider chain always targets the live server.
  void listenWithPortFallback(server, host, port, 10)
    .then((bound) => {
      actualPort = bound
      log.info('adapter: local OpenAI-compatible server started', {
        baseUrl: urlFor(bound),
        requestedPort: port,
        fellBack: bound !== port,
      })
    })
    .catch((err) => {
      log.error('adapter: failed to bind any port', { startPort: port, err: String(err) })
    })

  return {
    close: async () => new Promise<void>((resolve) => server.close(() => resolve())),
    getInfo: () => ({ enabled: true, url: urlFor(actualPort) }),
  }
}

type SiteSendResult =
  | { kind: 'ok'; text: string; sendSeq: string }
  | { kind: 'quota' }
  | { kind: 'error'; status: number; message: string }

interface SendDeps {
  win: BrowserWindow
  store: SiteStore
  bvm: BrowserViewManager
}

/**
 * Drive one concrete account through a single chat send: ensure runtime health,
 * apply the requested model variant / effort tier / tools, dispatch, and wait
 * for the reply to settle. Shared by the concrete and pool-group request paths.
 */
async function sendViaSite(
  deps: SendDeps,
  site: SiteConfig,
  spec: ParsedModelSpec,
  userText: string,
): Promise<SiteSendResult> {
  const { win, store, bvm } = deps
  const managed = bvm.ensureHealthy(site.siteId, site.url)
  if (!managed || !bvm.isSiteHealthy(site.siteId)) {
    return { kind: 'error', status: 503, message: `site runtime unhealthy: ${site.siteId}` }
  }
  managed.view.webContents.focus()

  // M13: apply the requested in-site model variant. Gated: switching starts a
  // NEW conversation and is slow, so only when it differs from the page's
  // current model (tracked via activeModel). Persisting lets the next skip.
  if (
    spec.modelId &&
    site.modelSwitcherSelector &&
    site.availableModels?.some((m) => m.id === spec.modelId) &&
    site.activeModel !== spec.modelId
  ) {
    const sw = await applyModelSwitch(managed.view.webContents, site, spec.modelId)
    if (sw.ok) store.setActiveModel(site.siteId, spec.modelId)
    else log.info('adapter: model-switch skipped', { siteId: site.siteId, modelId: spec.modelId, reason: sw.reason })
  }
  // M13: apply the requested reasoning-effort tier (e.g. Claude Effort High).
  if (
    spec.effort &&
    site.effortLevels?.some((e) => e.id === spec.effort) &&
    site.activeEffort !== spec.effort
  ) {
    const er = await applyEffort(managed.view.webContents, site, spec.effort)
    if (er.ok) store.setActiveEffort(site.siteId, spec.effort)
    else log.info('adapter: effort-switch skipped', { siteId: site.siteId, effort: spec.effort, reason: er.reason })
  }
  // M12/M13: ensure the requested tools (explicit spec tools, else the site's
  // persisted activeTools) are ON. Best-effort, idempotent, never blocks.
  const toolIds = spec.tools.length ? spec.tools : (site.activeTools ?? [])
  await ensureToolsEnabled(managed.view.webContents, site, toolIds)

  const send = await dispatchChatSend({
    win,
    store,
    bvm,
    validSiteId: site.siteId,
    validText: userText,
    managed,
  })
  if ('error' in send) return { kind: 'error', status: 500, message: send.error }

  const settled = await waitAdapterSettled(send.sendSeq, 130_000)
  if (settled.error) return { kind: 'error', status: 500, message: settled.error }
  if (settled.result?.quotaExhausted) return { kind: 'quota' }
  return { kind: 'ok', text: settled.result?.text ?? '', sendSeq: send.sendSeq }
}

function buildCompletion(model: string, sendSeq: string, text: string, siteId: string): unknown {
  return {
    id: `chatcmpl-${sendSeq}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    adapter: { siteId, sendSeq, path: getLastChatFailure()?.automationPath ?? 'unknown' },
  }
}

function buildPromptText(messages: OpenAIMessage[] | undefined): string {
  if (!messages?.length) return ''
  return messages
    .filter((m) => m.role === 'user' || m.role === 'system')
    .map((m) => `${m.role === 'system' ? '[System] ' : ''}${m.content}`)
    .join('\n\n')
    .trim()
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += String(chunk)
      if (data.length > 2_000_000) reject(new Error('payload-too-large'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}') as T)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

