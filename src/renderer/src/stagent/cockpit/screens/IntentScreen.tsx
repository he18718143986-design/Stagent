import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useCockpitContextOptional } from '../CockpitContext'
import { simpleTheme } from '../theme'
import type { CockpitScreenProps } from '../types'
import { SUGGESTION_CHIPS, TASK_TYPES } from '../types'
import { groupModels } from '../../model-grouping'
import { SettingsPanel } from '../components/SettingsPanel'

/**
 * 统一意图屏(渐进式披露):
 * - 主操作放大:白话标题 + 大输入框 + 建议项 + 保存位置 + 「开始做」。
 * - 「开始做」始终走澄清流程(onStartClarifyFlow),使决策类问题能浮现。
 * - 高级选项(任务类型 / 模型 / 需求润色 / API 设置 / 直接生成)折叠,
 *   默认开合跟随全局 showTechnical 密度,用户手动切换后本地优先。
 */
export function IntentScreen({
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
  const busy = !!state.busy || clarifyPending
  const hasWorkspace = workspacePath.trim().length > 0
  const folderLabel = hasWorkspace
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  const [advOpen, setAdvOpen] = useState(showTechnical)
  const advTouched = useRef(false)
  useEffect(() => {
    if (!advTouched.current) {
      setAdvOpen(showTechnical)
    }
  }, [showTechnical])

  const pickWorkspace = (): void => {
    void send({ type: 'pickTaskWorkspaceFolder' })
  }
  const startClarify = (): void => {
    if (!draft.trim()) {
      return
    }
    onStartClarifyFlow?.()
  }
  const canGenerate = draft.trim().length > 0 && workspacePath.trim().length > 0

  return (
    <div className={`${simpleTheme.card} max-w-lg w-full mx-auto`}>
      <h1 className={`${simpleTheme.hero} text-center mb-1`}>你想做个什么？</h1>
      <p className={`${simpleTheme.subheading} text-center mb-6`}>用大白话说就行,剩下的交给我们</p>
      <textarea
        className="w-full text-base border border-stone-200 rounded-2xl px-4 py-3 resize-y min-h-[120px] shadow-inner focus:outline-none focus:ring-2 focus:ring-stagent-orange/40"
        placeholder="比如:帮我做一个能记账的小工具"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex flex-wrap gap-2 mt-3 mb-4">
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
      <div className={`mb-4 p-3 ${simpleTheme.mutedPanel} space-y-2`}>
        <div className="text-sm text-stone-600">成果保存在哪里?</div>
        {hasWorkspace ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-stagent-success truncate" title={workspacePath}>
              📁 {folderLabel}
            </span>
            <button type="button" className="text-xs text-stagent-orange hover:underline shrink-0" onClick={pickWorkspace}>
              换一个
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-amber-700">首次使用请先选一个文件夹,用来存放生成的文件</p>
            <button
              type="button"
              className={`${simpleTheme.secondaryBtn} w-full text-center text-sm py-2`}
              onClick={pickWorkspace}
            >
              📁 选择保存位置
            </button>
          </>
        )}
      </div>
      <button type="button" className={simpleTheme.primaryBtn} disabled={!draft.trim() || busy} onClick={startClarify}>
        {clarifyPending ? '⏳ 正在理解…' : '✨ 开始做'}
      </button>
      {!hasWorkspace && draft.trim() && (
        <p className="text-xs text-stone-400 mt-2 text-center">还没选文件夹时,点「开始做」也会弹出选择窗口</p>
      )}

      <div className="mt-4">
        <button
          type="button"
          aria-expanded={advOpen}
          className="w-full text-left text-xs text-stone-400 hover:text-stagent-orange flex items-center gap-1"
          onClick={() => {
            advTouched.current = true
            setAdvOpen((v) => !v)
          }}
        >
          <span>{advOpen ? '▼' : '▶'}</span>
          高级选项(开发者)
        </button>
        {advOpen && (
          <div className={`mt-2 p-3 ${simpleTheme.mutedPanel} space-y-3`}>
            <label className="block space-y-1">
              <span className="text-xs text-stone-600">任务类型</span>
              <select
                className="w-full text-sm border border-stone-200 rounded-lg px-2 py-1.5 bg-white"
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-stone-600">模型</span>
              {models.length === 0 ? (
                <span className="block text-xs text-stone-400">无可用模型</span>
              ) : (
                <select
                  className="w-full text-sm border border-stone-200 rounded-lg px-2 py-1.5 bg-white"
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
            </label>
            {state.polished && (
              <div className="border border-green-200 bg-green-50 rounded-lg p-2 text-xs">
                <div className="font-medium text-green-800 mb-1">润色结果可用</div>
                <button type="button" className="text-green-700 underline" onClick={() => setDraft(state.polished!.text)}>
                  采用润色文本
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs border border-stone-300 rounded-lg px-3 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50"
                disabled={!draft.trim() || busy}
                onClick={() =>
                  void send({
                    type: 'polishUserTask',
                    draft: draft.trim(),
                    taskType,
                    taskWorkspacePath: workspacePath.trim() || undefined,
                  })
                }
              >
                需求润色
              </button>
              <button
                type="button"
                className="text-xs border border-stone-300 rounded-lg px-3 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50"
                disabled={!canGenerate || busy}
                onClick={() =>
                  void send({
                    type: 'generateWorkflow',
                    userInput: draft.trim(),
                    taskType,
                    taskWorkspacePath: workspacePath.trim(),
                    ...(state.polished
                      ? { polishContext: { originalDraft: draft, polishedAt: state.polished.polishedAt } }
                      : {}),
                  })
                }
              >
                直接生成工作流(跳过澄清)
              </button>
              <button
                type="button"
                className="text-xs text-stone-500 hover:underline"
                onClick={() => setShowSettings(!showSettings)}
              >
                {showSettings ? '收起 API 设置' : 'API 设置'}
              </button>
            </div>
            {showSettings && <SettingsPanel load={getConfig} save={saveConfig} onClose={() => setShowSettings(false)} />}
          </div>
        )}
      </div>
    </div>
  )
}
