import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useCockpitContextOptional } from '../CockpitContext'
import { groupModels } from '../../model-grouping'
import { simpleTheme } from '../theme'
import type { CockpitScreenProps } from '../types'
import { SUGGESTION_CHIPS, TASK_TYPES } from '../types'
import { PillOptionGroup, inferRecommendedOption } from '../components/PillOptionGroup'
import { SettingsPanel } from '../components/SettingsPanel'

function Bubble({
  role,
  pulse = false,
  children,
}: {
  role: 'ai' | 'user'
  pulse?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  if (role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-stagent-orange/20 border border-stagent-orange/30 text-slate-100 px-3 py-2 text-sm">
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start mb-3">
      <div
        className={`max-w-[90%] rounded-2xl rounded-bl-sm bg-white/5 border border-white/10 text-slate-200 px-3 py-2 text-sm ${
          pulse ? 'animate-pulse' : ''
        }`}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * 对话式需求接入(MVP,复用现有澄清,纯前端):
 * AI 主导、有界对话 —— 开场 → 用户说需求 → 理解 → 澄清问题(快捷回复)→ 收口生成。
 * 复用 clarifyStart/clarifyQuestions/generateWorkflow,不改引擎。
 */
export function IntakeChatScreen({
  engine,
  form,
  send,
  onStartClarifyFlow,
  clarifyPending = false,
  showSettings,
  setShowSettings,
}: CockpitScreenProps & {
  showSettings: boolean
  setShowSettings: (v: boolean) => void
}): React.JSX.Element {
  const ctx = useCockpitContextOptional()
  const showTechnical = ctx?.showTechnical ?? false
  const { state, models, preferredModel, setModel, getConfig, saveConfig } = engine
  const { draft, setDraft, taskType, setTaskType, workspacePath } = form
  const modelGroups = useMemo(() => groupModels(models), [models])

  const questions = state.clarify ?? []
  const understanding = clarifyPending || (!!state.busy && questions.length === 0)
  const submitted = clarifyPending || questions.length > 0 || !!state.busy
  const hasWorkspace = workspacePath.trim().length > 0
  const folderLabel = hasWorkspace
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [advOpen, setAdvOpen] = useState(showTechnical)
  const advTouched = useRef(false)
  useEffect(() => {
    if (!advTouched.current) {
      setAdvOpen(showTechnical)
    }
  }, [showTechnical])

  const pickWorkspace = (): void => void send({ type: 'pickTaskWorkspaceFolder' })
  const sendRequirement = (): void => {
    if (!draft.trim()) {
      return
    }
    onStartClarifyFlow?.()
  }
  const submitClarify = (useDefaults: boolean): void => {
    const payload: Record<string, string> = {}
    for (const q of questions) {
      const rec = inferRecommendedOption(q.options ?? [])
      payload[q.id] = useDefaults ? (rec ?? answers[q.id] ?? '') : (answers[q.id] ?? rec ?? '')
    }
    void send({
      type: 'generateWorkflow',
      userInput: draft.trim(),
      taskType,
      taskWorkspacePath: workspacePath.trim(),
      clarifyAnswers: payload,
      ...(state.polished
        ? { polishContext: { originalDraft: draft, polishedAt: state.polished.polishedAt } }
        : {}),
    })
  }

  return (
    <div className="max-w-lg w-full mx-auto">
      <Bubble role="ai">想做点什么?跟我说说就行 😊</Bubble>

      {submitted && draft.trim() && <Bubble role="user">{draft}</Bubble>}

      {understanding && <Bubble role="ai" pulse>{state.busy?.message ?? '正在理解你的需求…'}</Bubble>}

      {questions.length > 0 && (
        <Bubble role="ai">
          <div className="font-medium mb-2">几个小问题想跟你确认一下 👋</div>
          <div className="space-y-4 mb-3">
            {questions.map((q) => (
              <PillOptionGroup
                key={q.id}
                question={{
                  id: q.id,
                  text: q.text,
                  options: q.options,
                  recommendedOption: inferRecommendedOption(q.options ?? []),
                }}
                value={answers[q.id] ?? inferRecommendedOption(q.options ?? []) ?? ''}
                onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              />
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" className={`${simpleTheme.primaryBtn} flex-1 !py-2`} onClick={() => submitClarify(true)}>
              ✨ 都按推荐,直接开始
            </button>
            <button
              type="button"
              className={`${simpleTheme.secondaryBtn} flex-1 text-center !py-2`}
              onClick={() => submitClarify(false)}
            >
              选好了,继续
            </button>
          </div>
        </Bubble>
      )}

      {/* 输入区:仅在尚未提交需求时显示 */}
      {!submitted && (
        <div className={`mt-1 p-3 ${simpleTheme.mutedPanel} space-y-3`}>
          <div className="flex flex-wrap gap-2">
            {SUGGESTION_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                className={simpleTheme.chip}
                onClick={() => setDraft(`帮我做一个${c.label}`)}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
          <textarea
            className="w-full text-sm border border-white/15 rounded-xl px-3 py-2 resize-y min-h-[64px] focus:outline-none focus:ring-2 focus:ring-stagent-orange/40"
            placeholder="比如:帮我做一个能记账的小工具"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="text-xs text-slate-400 hover:text-stagent-accent truncate" onClick={pickWorkspace}>
              📁 {hasWorkspace ? folderLabel : '选择保存位置'}
            </button>
            <button
              type="button"
              className="text-sm bg-stagent-orange text-white px-4 py-2 rounded-full font-semibold hover:bg-orange-500 disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={sendRequirement}
            >
              发送 →
            </button>
          </div>

          <div>
            <button
              type="button"
              aria-expanded={advOpen}
              className="text-xs text-slate-500 hover:text-stagent-orange flex items-center gap-1"
              onClick={() => {
                advTouched.current = true
                setAdvOpen((v) => !v)
              }}
            >
              <span>{advOpen ? '▼' : '▶'}</span>
              高级选项(开发者)
            </button>
            {advOpen && (
              <div className="mt-2 space-y-2">
                <select
                  className="w-full text-sm border border-white/15 rounded-lg px-2 py-1.5"
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value)}
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {models.length > 0 && (
                  <select
                    className="w-full text-sm border border-white/15 rounded-lg px-2 py-1.5"
                    value={preferredModel}
                    onChange={(e) => void setModel(e.target.value)}
                  >
                    <option value="">默认({models[0]?.name ?? '自动'})</option>
                    {modelGroups.map((g) => (
                      <optgroup key={g.key} label={g.label}>
                        {g.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.text}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
                <button type="button" className="text-xs text-slate-400 hover:underline" onClick={() => setShowSettings(!showSettings)}>
                  {showSettings ? '收起 API 设置' : 'API 设置'}
                </button>
                {showSettings && <SettingsPanel load={getConfig} save={saveConfig} onClose={() => setShowSettings(false)} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
