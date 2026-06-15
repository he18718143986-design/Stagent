import React from 'react'
import { useCockpitContext } from '../../CockpitContext'
import { simpleTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { SUGGESTION_CHIPS } from '../../types'

export function SimpleIntentScreen({
  engine,
  form,
  send,
  onStartClarifyFlow,
  clarifyPending = false,
}: CockpitScreenProps): React.JSX.Element {
  const { setUiMode } = useCockpitContext()
  const { state } = engine
  const { draft, setDraft, workspacePath } = form
  const busy = !!state.busy || clarifyPending
  const hasWorkspace = workspacePath.trim().length > 0
  const folderLabel = hasWorkspace
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  const pickWorkspace = (): void => {
    void send({ type: 'pickTaskWorkspaceFolder' })
  }

  const startClarify = (): void => {
    if (!draft.trim()) {
      return
    }
    onStartClarifyFlow?.()
  }

  return (
    <div className={`${simpleTheme.card} max-w-lg w-full mx-auto`}>
      <h1 className={`${simpleTheme.heading} text-center mb-1`}>你想做个什么？</h1>
      <p className={`${simpleTheme.subheading} text-center mb-6`}>用大白话说就行，剩下的交给我们</p>
      <textarea
        className="w-full text-base border border-stone-200 rounded-2xl px-4 py-3 resize-y min-h-[120px] shadow-inner focus:outline-none focus:ring-2 focus:ring-stagent-orange/40"
        placeholder="比如：帮我做一个能记账的小工具"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex flex-wrap gap-2 mt-3 mb-4">
        {SUGGESTION_CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            className="text-sm px-3 py-1.5 rounded-full border border-stone-200 bg-white hover:border-stagent-orange hover:bg-orange-50"
            onClick={() => setDraft(`帮我做一个${c.label}`)}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>
      <div className="mb-4 p-3 rounded-xl bg-stone-50 border border-stone-100 space-y-2">
        <div className="text-sm text-stone-600">成果保存在哪里？</div>
        {hasWorkspace ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-stagent-success truncate" title={workspacePath}>
              📁 {folderLabel}
            </span>
            <button
              type="button"
              className="text-xs text-stagent-orange hover:underline shrink-0"
              onClick={pickWorkspace}
            >
              换一个
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-amber-700">首次使用请先选一个文件夹，用来存放生成的文件</p>
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
      <button
        type="button"
        className={simpleTheme.primaryBtn}
        disabled={!draft.trim() || busy}
        onClick={startClarify}
      >
        {clarifyPending ? '⏳ 正在理解…' : '✨ 开始做'}
      </button>
      {!hasWorkspace && draft.trim() && (
        <p className="text-xs text-stone-400 mt-2 text-center">还没选文件夹时，点「开始做」也会弹出选择窗口</p>
      )}
      <button
        type="button"
        className="w-full mt-4 text-xs text-stone-400 hover:text-stagent-orange text-center"
        onClick={() => setUiMode('pro')}
      >
        高级设置（开发者）
      </button>
    </div>
  )
}
