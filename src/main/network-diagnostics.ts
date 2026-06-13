/* ------------------------------------------------------------------ */
/*  App/session/backend proxy consistency diagnostics                  */
/* ------------------------------------------------------------------ */

import type { App as ElectronApp } from 'electron'
import log from 'electron-log'
import type { SiteStore } from './site-store'
import { getSession } from './session'

export interface NetworkDiagnosticsSnapshot {
  checkedAt: number
  proxyConfigured: boolean
  layers: Array<{ layer: 'app' | 'session' | 'backend'; status: 'ok' | 'warn' | 'fail'; detail: string }>
}

export interface ProxyConsistencyDeps {
  app: ElectronApp
  proxyUrlEnv: string
}

/** Latest diagnostics snapshot — updated after each consistency run */
export let networkDiagnosticsSnapshot: NetworkDiagnosticsSnapshot | null = null

export async function runProxyConsistencyCheck(store: SiteStore, deps: ProxyConsistencyDeps): Promise<void> {
  const configured = Boolean(deps.proxyUrlEnv.trim())
  const layers: NetworkDiagnosticsSnapshot['layers'] = []
  const appProxy = deps.app.commandLine.getSwitchValue('proxy-server')
  if (!configured) {
    layers.push({ layer: 'app', status: 'warn', detail: '未配置 HTTP(S)_PROXY，应用将走直连' })
  } else if (!appProxy) {
    layers.push({ layer: 'app', status: 'fail', detail: '检测到代理环境变量，但 app 层未生效 proxy-server' })
  } else {
    layers.push({ layer: 'app', status: 'ok', detail: `proxy-server=${appProxy}` })
  }

  if (!configured) {
    layers.push({ layer: 'session', status: 'warn', detail: '未配置代理，session 层跳过检查' })
  } else {
    const sites = store.list()
    const sample = sites.slice(0, 3)
    let mismatches = 0
    for (const s of sample) {
      try {
        const ses = getSession(s.siteId)
        const resolved = await ses.resolveProxy(s.url)
        if (/^DIRECT$/i.test((resolved ?? '').trim())) mismatches += 1
      } catch {
        mismatches += 1
      }
    }
    if (sample.length === 0) {
      layers.push({ layer: 'session', status: 'warn', detail: '暂无站点，session 层暂无法验证' })
    } else if (mismatches === 0) {
      layers.push({ layer: 'session', status: 'ok', detail: `抽样 ${sample.length} 个 session 已走代理解析` })
    } else {
      layers.push({
        layer: 'session',
        status: 'fail',
        detail: `抽样 ${sample.length} 个 session 中 ${mismatches} 个未解析到代理`,
      })
    }
  }

  if (!configured) {
    layers.push({ layer: 'backend', status: 'warn', detail: '当前进程未使用后端子进程，且未配置代理环境变量' })
  } else if (process.env['HTTPS_PROXY'] || process.env['https_proxy'] || process.env['HTTP_PROXY'] || process.env['http_proxy']) {
    layers.push({ layer: 'backend', status: 'ok', detail: '代理环境变量存在，可透传给后续子进程/外部命令' })
  } else {
    layers.push({
      layer: 'backend',
      status: 'fail',
      detail: '代理已配置到 app 层，但环境变量层缺失，后端进程可能不生效',
    })
  }

  networkDiagnosticsSnapshot = { checkedAt: Date.now(), proxyConfigured: configured, layers }
  log.info('network-diagnostics: proxy consistency check', networkDiagnosticsSnapshot)
}
