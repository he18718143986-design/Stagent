/* ------------------------------------------------------------------ */
/*  src/renderer/src/pages/ResourcesPage.tsx                          */
/*  Dual-mode: onboarding card grid (mode A) + management list (mode B) */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigation } from '../App'
import type {
  ChatFailureRecord,
  NetworkDiagnostics,
  RuntimeRecoveryPolicy,
  RuntimeStatsSnapshot,
  SiteWithStatus,
} from '../../../preload/index.d'
import SelectorDebugger from '../components/SelectorDebugger'
import CalibrationOverlay from '../components/CalibrationOverlay'

// ─── Preset catalog (cards shown in onboarding mode) ────────────────────────

interface PresetEntry {
  hostname: string
  label: string
  url: string
  icon: string // emoji or short text placeholder
}

function networkLayerFixSuggestion(
  layer: NetworkDiagnostics['layers'][0]['layer'],
  status: NetworkDiagnostics['layers'][0]['status'],
): string {
  if (layer === 'app' && status === 'fail') {
    return '建议：核对 HTTPS_PROXY / HTTP_PROXY，完全退出并重启应用，确认日志中出现 proxy-server=…'
  }
  if (layer === 'session' && status === 'fail') {
    return '建议：在该站点重新登录；若仍失败，可删除站点记录后重新添加以重建会话。'
  }
  if (layer === 'backend' && status === 'fail') {
    return '建议：启动 CLI/子进程时也导出相同代理变量，避免与 Electron app 层不一致。'
  }
  if (status === 'warn') {
    return '提示：多为未配置或未抽样验证；网络正常时可忽略，需要代理时请补齐环境变量。'
  }
  return ''
}

function chatFailureFixSuggestion(rec: ChatFailureRecord): string {
  switch (rec.kind) {
    case 'playwright-cdp':
      return '建议：启用 AUTOAI_ENABLE_CDP=1 或 AUTOAI_AUTOMATION_MODE=playwright 并重启；确认 AUTOAI_CDP_PORT 端口可达。'
    case 'navigation-interrupt':
      return '建议：生成期间勿手动刷新/跳转；若站点强制跳转，请先在网页完成验证。'
    case 'certificate-proxy':
      return '建议：检查代理或网关 HTTPS 解密、系统证书；尝试切换网络或直连排查。'
    case 'proxy-mismatch':
      return '建议：对齐终端与应用代理设置，并重跑下方「重新自检」。'
    case 'inject':
      return '建议：运行校准更新选择器，或等待 SPA 加载完成后再发送。'
    default:
      return '建议：结合运行时计数与代理自检逐项排查，必要时重新登录站点。'
  }
}

const PRESET_CATALOG: PresetEntry[] = [
  { hostname: 'chatgpt.com', label: 'ChatGPT', url: 'https://chatgpt.com', icon: '⊙' },
  { hostname: 'claude.ai', label: 'Claude', url: 'https://claude.ai', icon: '◎' },
  { hostname: 'gemini.google.com', label: 'Gemini', url: 'https://gemini.google.com', icon: '✦' },
  { hostname: 'chat.deepseek.com', label: 'DeepSeek', url: 'https://chat.deepseek.com', icon: '◈' },
  { hostname: 'kimi.moonshot.cn', label: 'Kimi', url: 'https://kimi.moonshot.cn', icon: '◉' },
  { hostname: 'grok.com', label: 'Grok', url: 'https://grok.com', icon: '✕' },
]

// ─── Status label helpers (text only — no color badges) ─────────────────────

function statusLabel(status: SiteWithStatus['status']): string {
  switch (status) {
    case 'connected': return '已连接'
    case 'disconnected': return '未登录'
    case 'quota-exhausted': return '额度用尽'
    case 'loading': return '登录中…'
    default: return '未知'
  }
}

interface RuntimeSnapshotFile {
  exportedAt?: string
  runtimeStats?: RuntimeStatsSnapshot
  siteMeta?: Record<string, { label?: string; hostname?: string }>
}

interface SnapshotCompareView {
  baseLabel: string
  newLabel: string
  totalsDelta: Record<
    'render-crash' | 'webcontents-destroyed' | 'network-fail' | 'chat-interrupted',
    number
  >
  bySite: Array<{ siteId: string; label: string; delta: number }>
}

// ─── Custom URL dialog ───────────────────────────────────────────────────────

function AddCustomDialog({
  onAdd,
  onCancel,
}: {
  onAdd: (url: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    const trimmed = val.trim()
    if (!trimmed) return
    // Normalise to https:// if no scheme given
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    onAdd(url)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-xl p-6 w-80 flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold text-gray-900">添加自定义网站</h2>
        <input
          ref={inputRef}
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="https://example.com"
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!val.trim()}
            className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium
                       disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            登录
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Mode A — Onboarding card grid ───────────────────────────────────────────

function OnboardingView({
  onSelect,
  onSkip,
}: {
  onSelect: (url: string) => void
  onSkip: () => void
}): React.JSX.Element {
  const [showCustom, setShowCustom] = useState(false)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-gray-900">选择你的 AI 助手</h1>
        <p className="mt-1.5 text-sm text-gray-500">登录后即可在 autoAI 中统一调用</p>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-md">
        {PRESET_CATALOG.map((p) => (
          <button
            key={p.hostname}
            onClick={() => onSelect(p.url)}
            className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200
                       bg-white px-4 py-5 hover:border-gray-400 hover:shadow-sm
                       transition-all text-center"
          >
            <span className="text-2xl leading-none">{p.icon}</span>
            <span className="text-sm font-medium text-gray-800">{p.label}</span>
          </button>
        ))}

        {/* Custom site card */}
        <button
          onClick={() => setShowCustom(true)}
          className="flex flex-col items-center gap-2 rounded-2xl border border-dashed
                     border-gray-300 bg-gray-50 px-4 py-5 hover:border-gray-400
                     hover:bg-white transition-all text-center"
        >
          <span className="text-2xl leading-none text-gray-400">+</span>
          <span className="text-sm font-medium text-gray-500">其他</span>
        </button>
      </div>

      <button
        onClick={onSkip}
        className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
      >
        跳过
      </button>

      {showCustom && (
        <AddCustomDialog
          onAdd={(url) => {
            setShowCustom(false)
            onSelect(url)
          }}
          onCancel={() => setShowCustom(false)}
        />
      )}
    </div>
  )
}

// ─── Rename dialog ────────────────────────────────────────────────────────────

function RenameDialog({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string
  onConfirm: (label: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [val, setVal] = React.useState(initial)
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    const trimmed = val.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-xl p-6 w-72 flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold text-gray-900">重命名</h2>
        <input
          ref={inputRef}
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="显示名称"
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm
                     focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!val.trim()}
            className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium
                       disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            确认
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Mode B — Management list ────────────────────────────────────────────────

interface MenuState {
  siteId: string
  x: number
  y: number
}

function ManagementView({
  sites,
  runtimeStats,
  runtimePolicy,
  runtimePolicyDraft,
  onRuntimePolicyDraftChange,
  onApplyRuntimePolicy,
  onRefreshRuntimeStats,
  onClearRuntimeStats,
  onExportRuntimeSnapshot,
  onImportBaseSnapshot,
  onImportNewSnapshot,
  compareView,
  adapterInfo,
  networkDiagnostics,
  lastChatFailure,
  onRefreshNetworkDiagnostics,
  onReLogin,
  onRemove,
  onRename,
  onDebug,
  onAddMore,
  onGoChat,
}: {
  sites: SiteWithStatus[]
  runtimeStats: RuntimeStatsSnapshot | null
  runtimePolicy: RuntimeRecoveryPolicy | null
  runtimePolicyDraft: RuntimeRecoveryPolicy
  onRuntimePolicyDraftChange: (patch: Partial<RuntimeRecoveryPolicy>) => void
  onApplyRuntimePolicy: () => void
  onRefreshRuntimeStats: () => void
  onClearRuntimeStats: (siteId?: string) => void
  onExportRuntimeSnapshot: () => void
  onImportBaseSnapshot: () => void
  onImportNewSnapshot: () => void
  compareView: SnapshotCompareView | null
  adapterInfo: { enabled: boolean; url: string } | null
  networkDiagnostics: NetworkDiagnostics | null
  lastChatFailure: ChatFailureRecord | null
  onRefreshNetworkDiagnostics: () => Promise<void>
  onReLogin: (siteId: string) => void
  onRemove: (siteId: string) => void
  onRename: (siteId: string, label: string) => void
  onDebug: (siteId: string) => void
  onAddMore: (url: string) => void
  onGoChat: () => void
}): React.JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [renamingSiteId, setRenamingSiteId] = useState<string | null>(null)
  // Per-site inline feedback message (e.g. "暂未重置…")
  const [checkMsgs, setCheckMsgs] = useState<Record<string, string>>({})
  const sortedStats = runtimeStats
    ? Object.values(runtimeStats.bySite).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return b.recentInWindow - a.recentInWindow
    })
    : []
  const formatDelta = (n: number): string => (n > 0 ? `+${n}` : `${n}`)

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!menu) return
    const handler = () => setMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [menu])

  return (
    <div className="flex flex-col h-screen">
      {/* Drag region / title bar */}
      <div className="drag-region h-10 shrink-0" />

      {/* Header row */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h1 className="text-base font-semibold text-gray-900">AI 资源管理</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCustom(true)}
            className="no-drag px-3 py-1.5 rounded-lg border border-gray-200 text-sm
                       text-gray-700 hover:border-gray-400 transition-colors"
          >
            + 添加
          </button>
          <button
            onClick={onGoChat}
            className="no-drag px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm
                       font-medium hover:bg-gray-700 transition-colors"
          >
            开始对话
          </button>
        </div>
      </div>

      {/* Site list */}
      <div className="flex-1 overflow-y-auto px-6 py-3 flex flex-col gap-1">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-800">稳定性面板</h2>
            <div className="flex items-center gap-2">
              <button
                className="no-drag px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-white"
                onClick={onRefreshRuntimeStats}
              >
                刷新
              </button>
              <button
                className="no-drag px-2 py-1 text-xs rounded-md border border-red-200 text-red-500 hover:bg-red-50"
                onClick={() => onClearRuntimeStats()}
              >
                清零全部
              </button>
              <button
                className="no-drag px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-white"
                onClick={onExportRuntimeSnapshot}
              >
                导出快照 JSON
              </button>
              <button
                className="no-drag px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-white"
                onClick={onImportBaseSnapshot}
              >
                导入基线
              </button>
              <button
                className="no-drag px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-white"
                onClick={onImportNewSnapshot}
              >
                导入对比
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-gray-600">
            <span>时间窗(秒)</span>
            <input
              type="number"
              min={10}
              className="no-drag w-20 rounded border border-gray-300 px-2 py-1 bg-white"
              value={Math.floor(runtimePolicyDraft.windowMs / 1000)}
              onChange={(e) => onRuntimePolicyDraftChange({ windowMs: Math.max(10, Number(e.target.value || 10)) * 1000 })}
            />
            <span>自动恢复阈值</span>
            <input
              type="number"
              min={0}
              className="no-drag w-16 rounded border border-gray-300 px-2 py-1 bg-white"
              value={runtimePolicyDraft.autoRecoverThreshold}
              onChange={(e) => onRuntimePolicyDraftChange({ autoRecoverThreshold: Math.max(0, Number(e.target.value || 0)) })}
            />
            <button
              className="no-drag px-2 py-1 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-700"
              onClick={onApplyRuntimePolicy}
            >
              应用策略
            </button>
          </div>

          <p className="text-[11px] text-gray-500 mb-2">
            当前策略：
            {runtimePolicy
              ? ` ${Math.round(runtimePolicy.windowMs / 1000)}s 窗口 / ${runtimePolicy.autoRecoverThreshold} 次内自动恢复`
              : ' 加载中...'}
            {runtimeStats
              ? `；全局累计：崩溃 ${runtimeStats.totals['render-crash']} / 销毁 ${runtimeStats.totals['webcontents-destroyed']} / 网络 ${runtimeStats.totals['network-fail']} / 中断 ${runtimeStats.totals['chat-interrupted']}`
              : ''}
          </p>

          {compareView && (
            <div className="mb-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
              <p className="mb-1">
                快照对比：{compareView.baseLabel} {'->'} {compareView.newLabel}
              </p>
              <p>
                全局增量：崩溃 {formatDelta(compareView.totalsDelta['render-crash'])} / 销毁 {formatDelta(compareView.totalsDelta['webcontents-destroyed'])} / 网络 {formatDelta(compareView.totalsDelta['network-fail'])} / 中断 {formatDelta(compareView.totalsDelta['chat-interrupted'])}
              </p>
              {compareView.bySite.length > 0 && (
                <p className="mt-1">
                  站点增量Top：{compareView.bySite.slice(0, 3).map((x) => `${x.label} ${formatDelta(x.delta)}`).join('，')}
                </p>
              )}
            </div>
          )}

          {networkDiagnostics && (
            <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <p>
                  代理一致性自检：
                  {networkDiagnostics.proxyConfigured ? '已检测到代理配置' : '未检测到代理配置'}
                  <span className="text-gray-500 ml-1">
                    （{new Date(networkDiagnostics.checkedAt).toLocaleString()}）
                  </span>
                </p>
                <button
                  type="button"
                  className="no-drag px-2 py-0.5 rounded border border-amber-400 text-amber-950 hover:bg-amber-100 text-[11px]"
                  onClick={() => void onRefreshNetworkDiagnostics()}
                >
                  重新自检
                </button>
              </div>
              {networkDiagnostics.layers.map((x) => (
                <div key={x.layer} className="mb-1">
                  <p>
                    {x.layer.toUpperCase()} [{x.status.toUpperCase()}] {x.detail}
                  </p>
                  {x.status !== 'ok' && (
                    <p className="text-[10px] text-amber-950/80 pl-2 border-l border-amber-300 mt-0.5">
                      {networkLayerFixSuggestion(x.layer, x.status)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {lastChatFailure && (
            <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-950">
              <p className="font-medium mb-0.5">
                最近发送失败（{lastChatFailure.automationPath} / {lastChatFailure.kind}）
              </p>
              <p className="text-rose-900/90">{lastChatFailure.hostname}</p>
              <p className="text-[10px] text-rose-900/80 mt-1">{lastChatFailure.detail}</p>
              <p className="text-[10px] text-rose-950 mt-1 border-l border-rose-300 pl-2">
                {chatFailureFixSuggestion(lastChatFailure)}
              </p>
            </div>
          )}

          <div className="max-h-44 overflow-y-auto rounded border border-gray-200 bg-white">
            {sortedStats.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-2">暂无故障统计</p>
            )}
            {sortedStats.map((s) => {
              const site = sites.find((x) => x.siteId === s.siteId)
              return (
                <div key={s.siteId} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-800 truncate">{site?.label ?? s.siteId}</p>
                    <p className="text-[11px] text-gray-500">
                      总计 {s.total} · 窗口内 {s.recentInWindow} · 崩溃 {s.byCategory['render-crash'].count} / 销毁 {s.byCategory['webcontents-destroyed'].count} / 网络 {s.byCategory['network-fail'].count} / 中断 {s.byCategory['chat-interrupted'].count}
                    </p>
                  </div>
                  <button
                    className="no-drag px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                    onClick={() => onClearRuntimeStats(s.siteId)}
                  >
                    清零
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mb-2">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-blue-900">本地 API 工作流（Adapter）</h2>
            <span className="text-[11px] text-blue-700">
              {adapterInfo?.enabled ? '已启用' : '未启用'}
            </span>
          </div>
          <p className="text-[11px] text-blue-900/90">
            入口：<code>{adapterInfo?.url || 'http://127.0.0.1:8787'}</code>
          </p>
          <p className="text-[11px] text-blue-900/80 mt-1">
            可直接对接你的业务平台：POST <code>/v1/chat/completions</code>，失败会附带结构化诊断字段。
          </p>
        </div>

        {sites.map((site) => (
          <div
            key={site.siteId}
            className="flex items-center justify-between rounded-xl px-4 py-3
                       hover:bg-gray-50 transition-colors group"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-900">{site.label}</span>
              <span className="text-xs text-gray-400">{site.hostname}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-gray-500">{statusLabel(site.status)}</span>
                {checkMsgs[site.siteId] && (
                  <span className="text-xs text-amber-600">{checkMsgs[site.siteId]}</span>
                )}
              </div>

              {/* Inline action button based on status */}
              {site.status === 'disconnected' && (
                <button
                  className="no-drag px-2.5 py-1 rounded-lg text-xs font-medium
                             bg-gray-900 text-white hover:bg-gray-700 transition-colors"
                  onClick={() => onReLogin(site.siteId)}
                >
                  登录
                </button>
              )}
              {site.status === 'quota-exhausted' && (
                <button
                  className="no-drag px-2.5 py-1 rounded-lg text-xs font-medium
                             border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                  onClick={async () => {
                    // Clear any previous message while checking
                    setCheckMsgs((m) => ({ ...m, [site.siteId]: '检查中…' }))
                    const result = await window.autoAI.site
                      .checkQuota(site.siteId)
                      .catch(() => ({ error: 'network', cleared: false }))
                    if (!result.cleared) {
                      setCheckMsgs((m) => ({
                        ...m,
                        [site.siteId]: '暂未重置，通常次日自动恢复',
                      }))
                    } else {
                      setCheckMsgs((m) => ({ ...m, [site.siteId]: '' }))
                    }
                  }}
                >
                  检查
                </button>
              )}

              {/* ··· context menu trigger */}
              <button
                className="no-drag opacity-0 group-hover:opacity-100 transition-opacity
                           w-6 h-6 flex items-center justify-center rounded-md
                           hover:bg-gray-200 text-gray-500 text-base leading-none"
                onClick={(e) => {
                  e.stopPropagation()
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setMenu({ siteId: site.siteId, x: rect.left, y: rect.bottom + 4 })
                }}
                aria-label="更多操作"
              >
                ···
              </button>
            </div>
          </div>
        ))}

        {sites.length === 0 && (
          <p className="text-sm text-gray-400 text-center mt-12">还没有添加任何 AI 网站</p>
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-lg border border-gray-100
                     py-1 w-36 text-sm"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-50"
            onClick={() => {
              onReLogin(menu.siteId)
              setMenu(null)
            }}
          >
            重新登录
          </button>
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-50"
            onClick={() => {
              setRenamingSiteId(menu.siteId)
              setMenu(null)
            }}
          >
            重命名
          </button>
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-50"
            onClick={() => {
              onDebug(menu.siteId)
              setMenu(null)
            }}
          >
            调试选择器
          </button>
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-50 text-red-500"
            onClick={() => {
              onRemove(menu.siteId)
              setMenu(null)
            }}
          >
            删除
          </button>
        </div>
      )}

      {showCustom && (
        <AddCustomDialog
          onAdd={(url) => {
            setShowCustom(false)
            onAddMore(url)
          }}
          onCancel={() => setShowCustom(false)}
        />
      )}

      {renamingSiteId && (
        <RenameDialog
          initial={sites.find((s) => s.siteId === renamingSiteId)?.label ?? ''}
          onConfirm={(label) => {
            onRename(renamingSiteId, label)
            setRenamingSiteId(null)
          }}
          onCancel={() => setRenamingSiteId(null)}
        />
      )}
    </div>
  )
}

// ─── ResourcesPage — root component with mode switching ─────────────────────

/** Single enum drives all four UI branches — no boolean/string combinations. */
type View = 'onboarding' | 'manage' | 'logging-in' | 'calibrating'

export default function ResourcesPage(): React.JSX.Element {
  const { go } = useNavigation()
  const [sites, setSites] = useState<SiteWithStatus[]>([])
  const [view, setView] = useState<View>('onboarding')
  // siteId associated with the current view (logging-in or calibrating)
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null)
  // hostname whose SelectorDebugger sheet is open (overlay on 'manage')
  const [debuggingHostname, setDebuggingHostname] = useState<string | null>(null)
  // Inline error message for failed async actions
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStatsSnapshot | null>(null)
  const [networkDiagnostics, setNetworkDiagnostics] = useState<NetworkDiagnostics | null>(null)
  const [lastChatFailure, setLastChatFailure] = useState<ChatFailureRecord | null>(null)
  const [runtimePolicy, setRuntimePolicy] = useState<RuntimeRecoveryPolicy | null>(null)
  const [runtimePolicyDraft, setRuntimePolicyDraft] = useState<RuntimeRecoveryPolicy>({
    windowMs: 5 * 60_000,
    autoRecoverThreshold: 2,
  })
  const [baseSnapshot, setBaseSnapshot] = useState<RuntimeSnapshotFile | null>(null)
  const [newSnapshot, setNewSnapshot] = useState<RuntimeSnapshotFile | null>(null)
  const [adapterInfo, setAdapterInfo] = useState<{ enabled: boolean; url: string } | null>(null)
  const pollRef = useRef<number | null>(null)

  const refreshSites = useCallback(() => {
    window.autoAI.site.list().then((list) => {
      setSites(list)
      setView((prev) => {
        // Don't override logging-in or calibrating — those are transient states.
        if (prev === 'logging-in' || prev === 'calibrating') return prev
        return list.length > 0 ? 'manage' : 'onboarding'
      })
    }).catch(() => {})
  }, [])

  const refreshRuntime = useCallback(() => {
    window.autoAI.site.getRuntimePolicy().then((policy) => {
      setRuntimePolicy(policy)
      setRuntimePolicyDraft(policy)
    }).catch(() => {})
    window.autoAI.site.getRuntimeStats().then((stats) => {
      setRuntimeStats(stats)
    }).catch(() => {})
    window.autoAI.site.getNetworkDiagnostics().then((diag) => {
      setNetworkDiagnostics(diag)
    }).catch(() => {})
    window.autoAI.site.getLastChatFailure().then(setLastChatFailure).catch(() => {})
    window.autoAI.adapter.getInfo().then(setAdapterInfo).catch(() => {})
  }, [])

  const refreshNetworkDiagnostics = useCallback(async () => {
    const diag = await window.autoAI.site.refreshNetworkDiagnostics().catch(() => null)
    if (diag) setNetworkDiagnostics(diag)
    const fail = await window.autoAI.site.getLastChatFailure().catch(() => null)
    setLastChatFailure(fail)
  }, [])

  // ── Load initial site list ──────────────────────────────────────────────
  useEffect(() => {
    refreshSites()
    refreshRuntime()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [refreshRuntime, refreshSites])

  // ── Poll while a login window is open ───────────────────────────────────
  useEffect(() => {
    if (view === 'logging-in') {
      pollRef.current = window.setInterval(refreshSites, 1500)
    } else {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [view, refreshSites])

  // ── Listen for login success pushed from main process ───────────────────
  // Use a ref to read the latest view without re-subscribing on every change.
  const viewRef = useRef<View>(view)
  useEffect(() => { viewRef.current = view }, [view])

  useEffect(() => {
    const unsub = window.autoAI.site.onLoginSuccess((_payload) => {
      const wasOnboarding = viewRef.current === 'onboarding' || viewRef.current === 'logging-in'
      setActiveSiteId(null)
      refreshSites()
      if (wasOnboarding) {
        go('/chat')
      } else {
        setView('manage')
      }
    })
    return unsub
   
  }, [refreshSites, go])

  // ── Listen for status changes (probe / quota / re-login) ─────────────
  useEffect(() => {
    const unsub = window.autoAI.site.onStatusChanged(() => {
      refreshSites()
    })
    return unsub
  }, [refreshSites])

  useEffect(() => {
    const unsub = window.autoAI.site.onRuntimeEvent(() => {
      refreshRuntime()
    })
    return unsub
  }, [refreshRuntime])

  // ── Listen for calibrate:done ─────────────────────────────────────────
  useEffect(() => {
    const unsub = window.autoAI.calibrate.onDone(() => {
      setView('manage')
      setActiveSiteId(null)
      refreshSites()
    })
    return unsub
  }, [refreshSites])

  // ── Actions ─────────────────────────────────────────────────────────────

  async function handleSelectSite(url: string): Promise<void> {
    setErrorMsg(null)
    try {
      const config = await window.autoAI.site.add(url)
      await window.autoAI.site.openLogin(config.siteId)
      setActiveSiteId(config.siteId)
      setView('logging-in')
      refreshSites()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '添加网站失败，请检查 URL 后重试')
    }
  }

  async function handleReLogin(siteId: string): Promise<void> {
    setErrorMsg(null)
    // Set view state BEFORE the await so that viewRef.current is already
    // 'logging-in' when site:login-success arrives (fast-path sends it before
    // the IPC invoke returns, causing a race where wasOnboarding=false and
    // go('/chat') is skipped if setView runs after the event fires).
    setActiveSiteId(siteId)
    setView('logging-in')
    try {
      await window.autoAI.site.openLogin(siteId)
      refreshSites()
    } catch (err) {
      setActiveSiteId(null)
      setView(sites.length > 0 ? 'manage' : 'onboarding')
      setErrorMsg(err instanceof Error ? err.message : '打开登录窗口失败，请重试')
    }
  }

  async function handleRemove(siteId: string): Promise<void> {
    setErrorMsg(null)
    try {
      await window.autoAI.site.remove(siteId)
      if (activeSiteId === siteId) setActiveSiteId(null)
      if (debuggingHostname === siteId) setDebuggingHostname(null)
      if (view === 'logging-in' && activeSiteId === siteId) setView('manage')
      if (view === 'calibrating' && activeSiteId === siteId) setView('manage')
      refreshSites()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除失败，请重试')
    }
  }

  async function handleStartCalibrate(siteId: string): Promise<void> {
    setDebuggingHostname(null)
    setActiveSiteId(siteId)
    setView('calibrating')
    // Fire-and-forget — calibrate:done IPC will clear calibrating view
    window.autoAI.calibrate.start(siteId).catch(() => {
      setView('manage')
      setActiveSiteId(null)
    })
  }

  async function handleRename(siteId: string, label: string): Promise<void> {
    setErrorMsg(null)
    try {
      await window.autoAI.site.rename(siteId, label)
      refreshSites()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '重命名失败，请重试')
    }
  }

  function handleExportRuntimeSnapshot(): void {
    const snapshot = runtimeStats
    if (!snapshot) return
    const siteMeta = Object.fromEntries(
      sites.map((s) => [
        s.siteId,
        { label: s.label, hostname: s.hostname, status: s.status },
      ]),
    )
    const payload = {
      exportedAt: new Date().toISOString(),
      runtimePolicy: runtimePolicy ?? snapshot.policy,
      runtimeStats: snapshot,
      siteMeta,
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `runtime-stability-snapshot-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function selectJsonFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.click()
    })
  }

  async function importSnapshot(which: 'base' | 'new'): Promise<void> {
    setErrorMsg(null)
    const file = await selectJsonFile()
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as RuntimeSnapshotFile
      if (!parsed.runtimeStats) {
        setErrorMsg('快照格式无效：缺少 runtimeStats')
        return
      }
      if (which === 'base') setBaseSnapshot(parsed)
      else setNewSnapshot(parsed)
    } catch {
      setErrorMsg('快照解析失败，请选择有效 JSON 文件')
    }
  }

  const compareView: SnapshotCompareView | null = (() => {
    if (!baseSnapshot?.runtimeStats || !newSnapshot?.runtimeStats) return null
    const a = baseSnapshot.runtimeStats
    const b = newSnapshot.runtimeStats
    const siteIds = new Set<string>([
      ...Object.keys(a.bySite),
      ...Object.keys(b.bySite),
    ])
    const bySite = [...siteIds].map((siteId) => {
      const delta = (b.bySite[siteId]?.total ?? 0) - (a.bySite[siteId]?.total ?? 0)
      const label =
        newSnapshot.siteMeta?.[siteId]?.label ??
        baseSnapshot.siteMeta?.[siteId]?.label ??
        siteId
      return { siteId, label, delta }
    }).filter((x) => x.delta !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    return {
      baseLabel: baseSnapshot.exportedAt ?? '基线快照',
      newLabel: newSnapshot.exportedAt ?? '对比快照',
      totalsDelta: {
        'render-crash': b.totals['render-crash'] - a.totals['render-crash'],
        'webcontents-destroyed': b.totals['webcontents-destroyed'] - a.totals['webcontents-destroyed'],
        'network-fail': b.totals['network-fail'] - a.totals['network-fail'],
        'chat-interrupted':
          (b.totals['chat-interrupted'] ?? 0) - (a.totals['chat-interrupted'] ?? 0),
      },
      bySite,
    }
  })()

  // ── Render ───────────────────────────────────────────────────────────────

  if (view === 'calibrating') {
    return (
      <>
        <CalibrationOverlay
          hostname={sites.find((s) => s.siteId === activeSiteId)?.hostname ?? (activeSiteId ?? '')}
          onCancel={async () => {
            if (activeSiteId) await window.autoAI.calibrate.cancel(activeSiteId)
            setView('manage')
            setActiveSiteId(null)
          }}
        />
        {/* Minimal placeholder so the layout doesn't flicker */}
        <div className="flex flex-col h-screen">
          <div className="h-[120px] shrink-0" />
        </div>
      </>
    )
  }

  if (view === 'logging-in') {
    const site = sites.find((s) => s.siteId === activeSiteId)
    return (
      <div className="flex flex-col h-screen">
        <div className="drag-region h-10 shrink-0" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm text-gray-500">
            请在下方完成 <strong>{site?.label ?? activeSiteId}</strong> 的登录
          </p>
          <button
            className="no-drag text-xs text-gray-400 hover:text-gray-600 underline"
            onClick={async () => {
              if (activeSiteId) await window.autoAI.site.closeLogin(activeSiteId)
              setView(sites.length > 0 ? 'manage' : 'onboarding')
              setActiveSiteId(null)
              refreshSites()
            }}
          >
            取消登录
          </button>
        </div>
      </div>
    )
  }

  if (view === 'onboarding') {
    return (
      <div className="flex flex-col h-screen">
        <div className="drag-region h-10 shrink-0" />
        {errorMsg && (
          <p className="px-6 py-2 text-xs text-red-500 text-center">{errorMsg}</p>
        )}
        <OnboardingView
          onSelect={handleSelectSite}
          onSkip={() => go('/chat')}
        />
      </div>
    )
  }

  // view === 'manage'
  return (
    <>
      {errorMsg && (
        <div className="fixed top-12 inset-x-0 flex justify-center z-50 pointer-events-none">
          <p className="text-xs text-red-500 bg-white border border-red-200 rounded-lg px-3 py-1.5 shadow-sm">
            {errorMsg}
          </p>
        </div>
      )}
      <ManagementView
        sites={sites}
        runtimeStats={runtimeStats}
        runtimePolicy={runtimePolicy}
        runtimePolicyDraft={runtimePolicyDraft}
        onRuntimePolicyDraftChange={(patch) => setRuntimePolicyDraft((prev) => ({ ...prev, ...patch }))}
        onApplyRuntimePolicy={async () => {
          const next = await window.autoAI.site.setRuntimePolicy(runtimePolicyDraft)
          setRuntimePolicy(next)
          const stats = await window.autoAI.site.getRuntimeStats()
          setRuntimeStats(stats)
        }}
        onRefreshRuntimeStats={refreshRuntime}
        onClearRuntimeStats={async (siteId?: string) => {
          await window.autoAI.site.clearRuntimeStats(siteId)
          refreshRuntime()
        }}
        onExportRuntimeSnapshot={handleExportRuntimeSnapshot}
        onImportBaseSnapshot={() => { void importSnapshot('base') }}
        onImportNewSnapshot={() => { void importSnapshot('new') }}
        compareView={compareView}
        adapterInfo={adapterInfo}
        networkDiagnostics={networkDiagnostics}
        lastChatFailure={lastChatFailure}
        onRefreshNetworkDiagnostics={refreshNetworkDiagnostics}
        onReLogin={handleReLogin}
        onRemove={handleRemove}
        onRename={handleRename}
        onDebug={setDebuggingHostname}
        onAddMore={handleSelectSite}
        onGoChat={() => go('/chat')}
      />

      {/* SelectorDebugger sheet — shown on top of management list */}
      {debuggingHostname && (() => {
        const site = sites.find((s) => s.siteId === debuggingHostname)
        if (!site) return null
        return (
          <SelectorDebugger
            site={site}
            onClose={() => setDebuggingHostname(null)}
            onRecalibrate={() => handleStartCalibrate(debuggingHostname)}
          />
        )
      })()}
    </>
  )
}
