import React, { useMemo } from 'react'
import { groupModels } from '../../../model-grouping'
import { proTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { TASK_TYPES } from '../../types'
import { SettingsPanel } from '../../components/SettingsPanel'

export function ProIntentScreen({
  engine,
  form,
  send,
  showSettings,
  setShowSettings,
}: CockpitScreenProps & {
  showSettings: boolean
  setShowSettings: (v: boolean) => void
}): React.JSX.Element {
  const { state, models, preferredModel, setModel, getConfig, saveConfig } = engine
  const { draft, setDraft, taskType, setTaskType, workspacePath, setWorkspacePath } = form
  const modelGroups = useMemo(() => groupModels(models), [models])
  const canGenerate = draft.trim().length > 0 && workspacePath.trim().length > 0

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className={`${proTheme.card} text-center py-8`}>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">主旨 · 信封</h2>
        <p className="text-sm text-gray-500 mb-4">描述交付目标，系统将自动规划决策式工作流</p>
        <textarea
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-y min-h-[7rem] text-left"
          placeholder="描述你想完成的任务…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-sm text-gray-600">任务类型</span>
          <select
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2"
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
        <label className="space-y-1">
          <span className="text-sm text-gray-600">工作文件夹</span>
          <div className="flex gap-2">
            <input
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
            />
            <button
              type="button"
              className="text-sm border border-gray-300 rounded-lg px-3 hover:bg-gray-50"
              onClick={() => void send({ type: 'pickTaskWorkspaceFolder' })}
            >
              选择…
            </button>
          </div>
        </label>
      </div>
      <div className={`${proTheme.card}`}>
        <div className="text-sm font-medium text-gray-700 mb-2">模型策略（难度路由占位）</div>
        <div className="grid sm:grid-cols-3 gap-2 text-xs text-gray-500 mb-2">
          <div>决策模型：与下方相同</div>
          <div>叶子模型：与下方相同</div>
          <div>集成模型：与下方相同</div>
        </div>
        <select
          className="w-full text-sm border border-gray-300 rounded px-2 py-2"
          value={preferredModel}
          onChange={(e) => void setModel(e.target.value)}
        >
          <option value="">默认（{models[0]?.name ?? '自动'}）</option>
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
        <button
          type="button"
          className="mt-2 text-xs text-gray-500 hover:underline"
          onClick={() => setShowSettings(!showSettings)}
        >
          {showSettings ? '收起 API 设置' : 'API 设置'}
        </button>
        {showSettings && <SettingsPanel load={getConfig} save={saveConfig} onClose={() => setShowSettings(false)} />}
      </div>
      {state.polished && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-3 text-sm">
          <div className="font-medium text-green-800 mb-1">润色结果</div>
          <button type="button" className="text-xs text-green-700 underline" onClick={() => setDraft(state.polished!.text)}>
            采用润色文本
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          disabled={!draft.trim() || !!state.busy}
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
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          disabled={!canGenerate || !!state.busy}
          onClick={() =>
            void send({
              type: 'clarifyStart',
              userInput: draft.trim(),
              taskType,
              taskWorkspacePath: workspacePath.trim(),
            })
          }
        >
          生成澄清问题 → 屏1
        </button>
        <button
          type="button"
          className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          disabled={!canGenerate || !!state.busy}
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
          直接生成工作流
        </button>
      </div>
    </div>
  )
}
