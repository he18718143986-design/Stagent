/* ------------------------------------------------------------------ */
/*  components/SelectorDebugger.tsx — Edit per-site selectors (M5)    */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react'
import type { SiteConfig, SelectorChain, SelectorFields, SelectorStrategy } from '../../../preload/index.d'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function topSelector(chain: SelectorChain | undefined): string {
  if (!chain || chain.length === 0) return ''
  const sorted = [...chain].sort((a, b) => b.priority - a.priority)
  return (sorted[0] as SelectorStrategy).selector
}

function toChain(sel: string): SelectorChain {
  return [{ selector: sel.trim(), method: 'css', priority: 10, failCount: 0 }]
}

// ─── Field row ────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-slate-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="px-3 py-2 rounded-lg border border-white/15 text-sm font-mono
                   text-slate-100 placeholder-gray-300
                   focus:outline-none focus:border-gray-400 transition-colors"
      />
    </div>
  )
}

// ─── SelectorDebugger ─────────────────────────────────────────────────────────

interface Props {
  site: SiteConfig
  onClose: () => void
  onRecalibrate: () => void
}

export default function SelectorDebugger({ site, onClose, onRecalibrate }: Props): React.JSX.Element {
  const [inputSel, setInputSel] = useState(topSelector(site.inputSelectors))
  const [sendSel, setSendSel] = useState(topSelector(site.sendSelectors))
  const [responseSel, setResponseSel] = useState(topSelector(site.responseSelectors))
  const [quotaSel, setQuotaSel] = useState(site.quotaExhaustedIndicator ?? '')
  const [uploadTrigger, setUploadTrigger] = useState(site.fileUploadTrigger ?? '')

  const [saving, setSaving] = useState(false)
  const [savedTs, setSavedTs] = useState(0)
  const justSaved = Date.now() - savedTs < 2500

  async function handleSave(): Promise<void> {
    setSaving(true)
    const fields: SelectorFields = {}

    if (inputSel.trim()) fields.inputSelectors = toChain(inputSel)
    if (sendSel.trim()) fields.sendSelectors = toChain(sendSel)
    if (responseSel.trim()) fields.responseSelectors = toChain(responseSel)
    // Always send string fields so the user can clear them
    fields.quotaExhaustedIndicator = quotaSel.trim()
    fields.fileUploadTrigger = uploadTrigger.trim()

    await window.autoAI.site.updateSelectors(site.siteId, fields)
    setSaving(false)
    setSavedTs(Date.now())
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 flex items-end justify-center bg-black/25 z-40"
      onClick={onClose}
    >
      {/* Sheet */}
      <div
        className="bg-stagent-surface rounded-t-2xl shadow-2xl w-full max-w-lg p-6 pb-8 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">调试选择器</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {site.label} · {site.hostname}
              {site.calibrated && <span className="ml-2 text-green-400">已手动校准</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="no-drag w-7 h-7 flex items-center justify-center rounded-full
                       hover:bg-white/10 text-slate-500 text-xl leading-none mt-0.5"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* 5 fields */}
        <div className="flex flex-col gap-3">
          <Field
            label="输入框 — inputSelector"
            value={inputSel}
            onChange={setInputSel}
            placeholder="#prompt-textarea"
          />
          <Field
            label="发送按钮 — sendSelector"
            value={sendSel}
            onChange={setSendSel}
            placeholder="button[aria-label*='send' i]"
          />
          <Field
            label="回复容器 — responseSelector"
            value={responseSel}
            onChange={setResponseSel}
            placeholder="[data-message-author-role='assistant']"
          />
          <Field
            label="额度耗尽标识 — quotaExhaustedIndicator（可选）"
            value={quotaSel}
            onChange={setQuotaSel}
            placeholder=".quota-banner  或  text=You've reached the usage cap"
          />
          <Field
            label="附件按钮 — fileUploadTrigger（可选）"
            value={uploadTrigger}
            onChange={setUploadTrigger}
            placeholder="button[aria-label*='attach' i]"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={onRecalibrate}
            className="no-drag flex-1 py-2 rounded-xl border border-white/15 text-sm
                       text-slate-200 hover:border-gray-400 transition-colors"
          >
            重新校准
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="no-drag flex-1 py-2 rounded-xl bg-gray-900 text-white text-sm
                       font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {saving ? '保存中…' : justSaved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
