import React, { useState } from 'react'
import { humanizeJargon } from '../../plainLanguage'
import type { StageArtifactHint } from '@stagent/core'
import { simpleTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { HowToUsePanel } from '../../components/HowToUsePanel'
import { TechnicalDetailsCollapsible } from '../../components/TechnicalDetailsCollapsible'

export function SimpleDeliveryScreen({ engine, form, send, onNewTask }: CockpitScreenProps): React.JSX.Element {
  const { state } = engine
  const [showHelp, setShowHelp] = useState(false)
  const title = state.workflow?.meta.title || form.draft.trim() || '你的成果'
  const workspace = state.workflow?.meta?.taskWorkspacePath ?? form.workspacePath

  const testTotal = state.qualityReport?.verificationRows.reduce((n, r) => n + r.totalRuns, 0) ?? 0
  const testPass = state.qualityReport?.verificationRows.reduce((n, r) => n + r.passCount, 0) ?? 0

  const openFolder = (): void => {
    if (workspace) {
      void send({ type: 'openArtifactFile', stageId: '', filePath: workspace })
    }
  }

  if (showHelp) {
    return <HowToUsePanel onClose={() => setShowHelp(false)} onRedownload={openFolder} />
  }

  return (
    <div className="max-w-lg w-full mx-auto space-y-4">
      <div className="text-center py-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-stagent-success text-white flex items-center justify-center text-3xl mb-3">
          ✓
        </div>
        <h1 className="text-3xl font-bold text-stagent-success mb-1">做好了！</h1>
        <p className="text-stone-600">已经测试通过，可以直接用了</p>
      </div>
      <div className={simpleTheme.card}>
        <h2 className="font-semibold text-stone-800 mb-4">你的成果</h2>
        <div className="flex flex-col items-center text-center gap-3">
          <div className="text-4xl">📁</div>
          <div className="font-bold text-lg text-stone-800">{humanizeJargon(title)}</div>
          <button type="button" className={`${simpleTheme.primaryBtn} !bg-stagent-success hover:!bg-green-700`} onClick={openFolder}>
            ⬇ 下载（双击就能用）
          </button>
          <button type="button" className={`${simpleTheme.secondaryBtn} !border-stagent-success !text-stagent-success`} onClick={() => setShowHelp(true)}>
            ❓ 怎么用？
          </button>
        </div>
      </div>
      {testTotal > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100 text-sm text-stagent-success">
          <span>🛡️</span>
          <span>
            全部 {testPass} 项测试通过 ✓
          </span>
        </div>
      )}
      <TechnicalDetailsCollapsible title="▼ 技术报告（给开发者看）" defaultOpen={false}>
        <div className="space-y-3 py-2">
          <div>
            <div className="font-medium text-stone-700 mb-1">做了什么</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {(state.workflow?.meta.userInput ?? form.draft)
                .split(/[。；\n]/)
                .filter(Boolean)
                .slice(0, 3)
                .map((line, i) => (
                  <li key={i}>{line.trim()}</li>
                ))}
            </ul>
          </div>
          {state.qualityReport && (
            <div>
              <div className="font-medium text-stone-700 mb-1">测试情况</div>
              <div className="text-stagent-success">
                {testPass}/{testTotal || testPass} 通过
              </div>
            </div>
          )}
          <div>
            <div className="font-medium text-stone-700 mb-1">文件清单</div>
            <ul className="list-disc pl-4">
              {Object.values(state.artifacts)
                .flat()
                .slice(0, 6)
                .map((a: StageArtifactHint, i) => (
                  <li key={i}>{a.filePath.split(/[\\/]/).pop() ?? a.filePath}</li>
                ))}
            </ul>
          </div>
        </div>
      </TechnicalDetailsCollapsible>
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 rounded-xl bg-orange-50 border border-orange-100 text-stone-700 hover:bg-orange-100/80"
        onClick={() => {
          form.setDraft(state.workflow?.meta.userInput ?? form.draft)
          onNewTask()
        }}
      >
        <span>💬 想再改点什么？跟我说一声</span>
        <span>→</span>
      </button>
    </div>
  )
}
