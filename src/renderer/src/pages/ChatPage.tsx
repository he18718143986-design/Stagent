/* ------------------------------------------------------------------ */
/*  src/renderer/src/pages/ChatPage.tsx — Main chat UI                */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigation } from '../App'
import type { SiteWithStatus } from '../../../preload/index.d'
import CalibrationOverlay from '../components/CalibrationOverlay'
import ModelPicker from '../components/ModelPicker'
import ToolToggles from '../components/ToolToggles'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'ai' | 'system'
  text: string
  siteId: string
  ts: number
}

function isLikelyAuthorLabelText(text: string): boolean {
  const compact = text
    .replace(/[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060\u00ad\u00a0\ufeff]/g, ' ')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
  if (!compact || compact.length > 30) return false
  return /^(chatgpt|assistant|claude|gemini|kimi|deepseek|copilot)(说|説|說)?[：:]?$/.test(compact)
}

function normalizeAiDisplayText(text: string): string {
  // Defensive UI-level sanitization:
  // even if older sessions already inserted author-label-only text into local
  // message state, never render it as the final AI answer.
  if (isLikelyAuthorLabelText(text)) return '（回复内容为空，请重试）'
  return text
}

// ─── MessageList ─────────────────────────────────────────────────────────────

function MessageList({
  messages,
  isGenerating,
  activeSiteId,
}: {
  messages: Message[]
  isGenerating: boolean
  activeSiteId: string
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isGenerating])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">发送一条消息开始对话</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
      {messages
        .filter((m) => m.siteId === activeSiteId)
        .map((m) => {
          // System messages render as centered gray small text (not bubble style)
          if (m.role === 'system') {
            return (
              <div key={m.id} className="flex justify-center">
                <span className="text-[11px] text-gray-400 bg-gray-50 rounded-full px-3 py-1">
                  {m.text}
                </span>
              </div>
            )
          }
          return (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                {m.role === 'ai' ? normalizeAiDisplayText(m.text) : m.text}
              </div>
            </div>
          )
        })}

      {/* Generation indicator */}
      {isGenerating && (
        <div className="flex justify-start">
          <div className="bg-gray-100 rounded-2xl px-4 py-2.5">
            <span className="text-sm text-gray-400 animate-pulse">正在生成…</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

// ─── MessageInput ─────────────────────────────────────────────────────────────

function MessageInput({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => void
  disabled: boolean
  placeholder: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      e.preventDefault()
      submit()
    }
  }

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-gray-400 transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder-gray-400
                     focus:outline-none disabled:cursor-not-allowed leading-relaxed"
          style={{ maxHeight: 180 }}
        />
        <button
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="no-drag mb-0.5 w-8 h-8 flex items-center justify-center rounded-full
                     bg-gray-900 text-white disabled:opacity-30
                     hover:bg-gray-700 transition-colors shrink-0"
          aria-label="发送"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 12V2M3 6l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-gray-300">
        Enter 发送 · Shift+Enter 换行
      </p>
    </div>
  )
}

// ─── MoreMenu ─────────────────────────────────────────────────────────────────

function MoreMenu({ onManage, onNewChat }: { onManage: () => void; onNewChat: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        className="no-drag w-8 h-8 flex items-center justify-center rounded-lg
                   hover:bg-gray-100 transition-colors text-gray-500 text-base leading-none"
        onClick={() => setOpen((v) => !v)}
        aria-label="更多"
      >
        ···
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 text-sm">
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-50"
            onClick={() => { setOpen(false); onManage() }}
          >
            管理 AI 资源
          </button>
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-50"
            onClick={() => { setOpen(false); onNewChat() }}
          >
            新建对话
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ChatPage ─────────────────────────────────────────────────────────────────

interface ChatPageProps {
  activeSiteId: string | null
  onActiveSiteIdChange: (siteId: string) => void
}

export default function ChatPage({ activeSiteId, onActiveSiteIdChange: _onActiveSiteIdChange }: ChatPageProps): React.JSX.Element {
  const { go } = useNavigation()
  const [sites, setSites] = useState<SiteWithStatus[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [calibratingSiteId, setCalibratingSiteId] = useState<string | null>(null)

  const activeSite = sites.find((s) => s.siteId === activeSiteId) ?? null

  // ── Load sites (local copy for labels, empty-state guard, quota checks) ──
  const loadSites = useCallback(() => {
    window.autoAI.site.list().then((list) => {
      setSites(list)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    loadSites()
  }, [loadSites])

  // Keep in sync with main-process status changes
  useEffect(() => {
    return window.autoAI.site.onStatusChanged(() => loadSites())
  }, [loadSites])

  // Runtime issue event from main process (crash/network + recovery decision).
  useEffect(() => {
    const unsub = window.autoAI.site.onRuntimeEvent((event) => {
      window.autoAI.site.getRuntimeStats(event.siteId).then((snapshot) => {
        const s = snapshot.bySite[event.siteId]
        const counts = s
          ? `累计(崩溃:${s.byCategory['render-crash'].count} / 销毁:${s.byCategory['webcontents-destroyed'].count} / 网络:${s.byCategory['network-fail'].count} / 中断:${s.byCategory['chat-interrupted'].count})`
          : '累计(暂无)'
        const action =
          event.recovery === 'auto-recreate'
            ? '已自动重建浏览器上下文，请重试刚才的问题。'
            : '短时异常过于频繁，请检查网络/账号状态后重试。'
        const text = `运行异常：${event.category} (${event.reason})。${action} ${counts}`
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'system', text, siteId: event.siteId, ts: Date.now() },
        ])
      }).catch(() => {
        const action =
          event.recovery === 'auto-recreate'
            ? '已自动重建浏览器上下文，请重试刚才的问题。'
            : '短时异常过于频繁，请检查网络/账号状态后重试。'
        const text = `运行异常：${event.category} (${event.reason})。${action}`
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'system', text, siteId: event.siteId, ts: Date.now() },
        ])
      })
    })
    return unsub
  }, [])

  // ── Listen for chat:reply ─────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.autoAI.chat.onReply(({ siteId, result }) => {
      setIsGenerating(false)
      const rawText = typeof result.text === 'string' ? result.text : undefined
      const safeText = rawText && isLikelyAuthorLabelText(rawText) ? '' : rawText
      const text =
        safeText && safeText.trim().length > 0
          ? safeText
          : (safeText !== undefined ? '（回复内容为空，请重试）' : '（暂不支持非文字回复）')
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'ai', text, siteId, ts: Date.now() },
      ])
    })
    return unsub
  }, [])

  // ── Listen for quota exhausted — notify only, no auto-switch ─────────
  // Auto-switching would silently break multi-turn conversation context:
  // the new account is a different AI session with no memory of prior turns.
  // Instead, show a clear notification and let the user decide.
  useEffect(() => {
    const unsub = window.autoAI.chat.onQuotaExhausted((exhaustedSiteId) => {
      setIsGenerating(false)
      // Refresh sites so the exhausted account's status updates in the dropdown
      window.autoAI.site.list().then((list) => {
        setSites(list)
        const hasOtherConnected = list.some(
          (s) => s.status === 'connected' && s.siteId !== exhaustedSiteId
        )
        const noticeText = hasOtherConnected
          ? '今日额度已用尽，请从上方标签栏切换其他账号继续对话'
          : '所有账号额度已用尽，请明天再试或在设置中添加新账号'
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'ai',
            text: noticeText,
            siteId: exhaustedSiteId,
            ts: Date.now(),
          },
        ])
      }).catch(() => {})
    })
    return unsub
  }, [])

  // ── Listen for calibrate:needed ───────────────────────────────────────
  useEffect(() => {
    const unsub = window.autoAI.calibrate.onNeeded(({ siteId }) => {
      setIsGenerating(false)
      setCalibratingSiteId(siteId)
      window.autoAI.calibrate.start(siteId).catch(() => {
        setCalibratingSiteId(null)
      })
    })
    return unsub
  }, [])

  // ── Listen for calibrate:done ─────────────────────────────────────────
  useEffect(() => {
    const unsub = window.autoAI.calibrate.onDone(() => {
      setCalibratingSiteId(null)
      loadSites()
      setErrorMsg(null)
    })
    return unsub
  }, [loadSites])

  // ── Model switch ──────────────────────────────────────────────────────
  // Model switching = starting a new conversation thread. Clear the local
  // messages for the current site and insert a system notice message.
  function handleModelSwitch(modelLabel: string): void {
    if (!activeSiteId) return
    setMessages((prev) => [
      // Keep messages from other sites unchanged; clear this site's messages
      ...prev.filter((m) => m.siteId !== activeSiteId),
      {
        id: crypto.randomUUID(),
        role: 'system',
        text: `已切换到 ${modelLabel}，已开启新对话。`,
        siteId: activeSiteId,
        ts: Date.now(),
      },
    ])
    // Refresh sites so the renderer reflects the new activeModel
    window.autoAI.site.list().then(setSites).catch(() => {})
  }

  // ── Send message ──────────────────────────────────────────────────────
  async function handleSend(text: string): Promise<void> {
    if (!activeSiteId || isGenerating) return
    setErrorMsg(null)

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text, siteId: activeSiteId, ts: Date.now() },
    ])
    setIsGenerating(true)

    const result = await window.autoAI.chat.send(activeSiteId, text)
    if (result?.error) {
      setIsGenerating(false)
      if (result.error === 'busy') {
        setErrorMsg('上一条消息还在生成中，请稍候')
      } else if (result.error === 'selectors-not-found') {
        setErrorMsg('未能自动识别输入框，已自动开始校准流程…')
      } else if (result.error === 'runtime-unhealthy') {
        setErrorMsg('浏览器运行上下文异常，请稍后重试或重新登录该站点')
      } else {
        setErrorMsg(`发送失败：${result.error}`)
      }
    }
  }

  const hasConnected = sites.some((s) => s.status === 'connected')

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Calibration overlay */}
      {calibratingSiteId && (
        <CalibrationOverlay
          hostname={sites.find((s) => s.siteId === calibratingSiteId)?.hostname ?? calibratingSiteId}
          onCancel={async () => {
            await window.autoAI.calibrate.cancel(calibratingSiteId)
            setCalibratingSiteId(null)
          }}
        />
      )}

      {/* Toolbar: ··· menu */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-gray-100 shrink-0">
        <MoreMenu
          onManage={() => go('/resources')}
          onNewChat={() => setMessages([])}
        />
      </div>

      {/* No connected sites guard — show only when there are no past messages */}
      {!hasConnected && messages.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-gray-400">还没有可用的 AI</p>
          <button
            className="no-drag text-xs text-gray-500 underline hover:text-gray-800"
            onClick={() => go('/resources')}
          >
            连接一个 AI →
          </button>
        </div>
      )}

      {/* Message list — always shown when there are messages (e.g. all-exhausted notice) */}
      {(hasConnected || messages.length > 0) && (
        <>
          <MessageList
            messages={messages}
            isGenerating={isGenerating}
            activeSiteId={activeSiteId ?? ''}
          />

          {errorMsg && (
            <p className="px-6 pb-1 text-xs text-red-500 text-center">{errorMsg}</p>
          )}

          {isGenerating && (
            <p className="px-6 pb-1 text-xs text-gray-400 text-center animate-pulse">
              {activeSite ? `${activeSite.label} 正在生成…` : '正在生成…'}
            </p>
          )}

          {hasConnected && (
            <div className="px-4 pt-1 pb-0 flex flex-col gap-1.5">
              <ModelPicker
                site={activeSite}
                isGenerating={isGenerating}
                onModelSwitch={handleModelSwitch}
              />
              <ToolToggles
                site={activeSite}
                isGenerating={isGenerating}
                onToggled={() => window.autoAI.site.list().then(setSites).catch(() => {})}
              />
            </div>
          )}

          {hasConnected && (
            <MessageInput
              onSend={handleSend}
              disabled={isGenerating || !activeSiteId || activeSite?.status === 'quota-exhausted'}
              placeholder={
                isGenerating
                  ? (activeSite ? `${activeSite.label} 正在生成…` : '正在生成…')
                  : activeSite?.status === 'quota-exhausted'
                  ? '当前账号额度已用尽，请从上方切换其他账号'
                  : activeSite
                    ? `给 ${activeSite.label} 发消息…`
                    : '发消息…'
              }
            />
          )}
        </>
      )}
    </div>
  )
}
