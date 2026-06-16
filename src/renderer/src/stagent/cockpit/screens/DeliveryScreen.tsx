import React, { useMemo, useState } from 'react'
import type { StageArtifactHint } from '@stagent/core'
import { humanizeJargon } from '../plainLanguage'
import { simpleTheme } from '../theme'
import type { CockpitScreenProps } from '../types'
import { HowToUsePanel } from '../components/HowToUsePanel'
import { TechnicalDetailsCollapsible } from '../components/TechnicalDetailsCollapsible'
import { ArtifactsPanel } from '../components/ArtifactsPanel'
import { newArtifactPaths } from '../derive/newArtifactPaths'
import { buildAcceptanceReport } from '../derive/acceptanceReport'
import { buildRetrospective } from '../derive/retrospective'
import { QualityReportPanel } from '../../QualityReportPanel'

/**
 * 统一交付屏(渐进式披露)。
 * 英雄结果 + 下载/打开 + 怎么用常驻;质量报告 / 文件清单 / DELIVERY.md
 * 折叠进技术报告(默认开合跟随 showTechnical)。
 */
export function DeliveryScreen({ engine, form, send, onNewTask }: CockpitScreenProps): React.JSX.Element {
  const { state, stages } = engine
  const [showHelp, setShowHelp] = useState(false)
  const title = state.workflow?.meta.title || form.draft.trim() || '你的成果'
  const workspace = state.workflow?.meta?.taskWorkspacePath ?? form.workspacePath

  const testTotal = state.qualityReport?.verificationRows.reduce((n, r) => n + r.totalRuns, 0) ?? 0
  const testPass = state.qualityReport?.verificationRows.reduce((n, r) => n + r.passCount, 0) ?? 0
  const afkPassed = state.qualityReport ? state.qualityReport.afk.passed : undefined
  const testsAllPassed = testTotal === 0 ? undefined : testPass >= testTotal
  // 仅当确有报告且明确未通过时才示警,避免无报告时误判。
  const hasConcern = afkPassed === false || testsAllPassed === false

  const deliveryArtifact = Object.values(state.artifacts)
    .flat()
    .find((a: StageArtifactHint) => /DELIVERY\.md/i.test(a.filePath))
  const newPaths = useMemo(() => newArtifactPaths(state.artifacts), [state.artifacts])
  const acceptance = useMemo(
    () => buildAcceptanceReport({ userInput: state.workflow?.meta.userInput ?? form.draft, qualityReport: state.qualityReport }),
    [state.workflow?.meta.userInput, form.draft, state.qualityReport],
  )
  const retro = useMemo(
    () => buildRetrospective({ stages, qualityReport: state.qualityReport, engineActivityFeed: state.engineActivityFeed }),
    [stages, state.qualityReport, state.engineActivityFeed],
  )
  const acceptanceTone =
    acceptance.overall === 'pass'
      ? 'bg-green-500/15 text-green-300'
      : acceptance.overall === 'fail'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-white/10 text-slate-300'
  const acceptanceLabel =
    acceptance.overall === 'pass' ? '已通过' : acceptance.overall === 'fail' ? '未通过' : '无报告'

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
        <div
          className={`w-16 h-16 mx-auto rounded-full text-white flex items-center justify-center text-3xl mb-3 ${
            hasConcern ? 'bg-amber-500' : 'bg-stagent-success'
          }`}
        >
          {hasConcern ? '!' : '✓'}
        </div>
        <h1 className={`text-3xl font-bold mb-1 ${hasConcern ? 'text-amber-400' : 'text-green-400'}`}>
          {hasConcern ? '做完了，但有检查没通过' : '做好了！'}
        </h1>
        <p className="text-slate-400">
          {hasConcern ? '部分自动检查未通过，建议先看下方技术报告再使用' : '已经测试通过，可以直接用了'}
        </p>
      </div>

      <div className={simpleTheme.card}>
        <h2 className="font-semibold text-slate-100 mb-4">你的成果</h2>
        <div className="flex flex-col items-center text-center gap-3">
          <div className="text-4xl">📁</div>
          <div className="font-bold text-lg text-slate-100">{humanizeJargon(title)}</div>
          <button
            type="button"
            className={`${simpleTheme.primaryBtn} !bg-stagent-success hover:!bg-green-700`}
            onClick={openFolder}
          >
            ⬇ 下载(双击就能用)
          </button>
          <button
            type="button"
            className={`${simpleTheme.secondaryBtn} !border-stagent-success !text-stagent-success`}
            onClick={() => setShowHelp(true)}
          >
            ❓ 怎么用?
          </button>
        </div>
      </div>

      {testTotal > 0 &&
        (testsAllPassed ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-sm text-green-300">
            <span>🛡️</span>
            <span>全部 {testPass} 项测试通过 ✓</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
            <span>⚠️</span>
            <span>
              {testPass}/{testTotal} 项测试通过（部分未通过，详见技术报告）
            </span>
          </div>
        ))}

      <div className={simpleTheme.card}>
        <h2 className="font-semibold text-slate-100 mb-3">验收报告</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-slate-400 mb-1">需求清单</div>
            <ul className="list-disc pl-4 text-slate-300 space-y-0.5">
              {acceptance.requirements.length > 0 ? (
                acceptance.requirements.map((r, i) => <li key={i}>{r}</li>)
              ) : (
                <li className="text-slate-500 list-none">（无）</li>
              )}
            </ul>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">整体验证</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${acceptanceTone}`}>{acceptanceLabel}</span>
          </div>
          {acceptance.knownIssues.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1">已知问题</div>
              <ul className="list-disc pl-4 text-red-300 space-y-0.5">
                {acceptance.knownIssues.slice(0, 5).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="text-xs text-slate-400 mb-1">建议的下一步</div>
            <ul className="list-disc pl-4 text-slate-300 space-y-0.5">
              {acceptance.nextSteps.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={simpleTheme.card}>
        <h2 className="font-semibold text-slate-100 mb-3">本次复盘</h2>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { n: retro.decisions, label: '你的关键决策' },
            { n: retro.stages, label: '执行阶段' },
            { n: retro.testsPassed, label: '测试通过' },
            { n: retro.selfHeals, label: '自动修复' },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
              <div className="text-2xl font-bold text-slate-100 tabular-nums">{t.n}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{t.label}</div>
            </div>
          ))}
        </div>
        {retro.keyDecisions.length > 0 && (
          <div>
            <div className="text-xs text-slate-400 mb-1">关键决策</div>
            <ul className="space-y-1">
              {retro.keyDecisions.map((d, i) => (
                <li key={i} className="text-sm text-slate-300 flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  {humanizeJargon(d)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {workspace && (
        <ArtifactsPanel
          rootPath={workspace}
          newPaths={newPaths}
          refreshNonce={state.fileTreeRevision}
          onOpenFolder={openFolder}
          onSelectFile={(n) => void send({ type: 'openArtifactFile', stageId: '', filePath: n.path })}
        />
      )}

      <TechnicalDetailsCollapsible title="技术报告(给开发者看)" defaultOpen={hasConcern || undefined}>
        <div className="space-y-3 py-2">
          {state.qualityReport && <QualityReportPanel report={state.qualityReport} />}
          <div>
            <div className="font-medium text-slate-300 mb-1">做了什么</div>
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
          <div>
            <div className="font-medium text-slate-300 mb-1">文件清单</div>
            <ul className="list-disc pl-4">
              {Object.values(state.artifacts)
                .flat()
                .slice(0, 6)
                .map((a: StageArtifactHint, i) => (
                  <li key={i}>{a.filePath.split(/[\\/]/).pop() ?? a.filePath}</li>
                ))}
            </ul>
          </div>
          {deliveryArtifact && (
            <button
              type="button"
              className="text-stagent-accent hover:underline"
              onClick={() =>
                void send({ type: 'openArtifactFile', stageId: '', filePath: deliveryArtifact.filePath })
              }
            >
              打开 DELIVERY.md
            </button>
          )}
        </div>
      </TechnicalDetailsCollapsible>

      <button
        type="button"
        className="w-full flex items-center justify-between p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-slate-200 hover:bg-orange-500/15"
        onClick={() => {
          form.setDraft(state.workflow?.meta.userInput ?? form.draft)
          onNewTask()
        }}
      >
        <span>💬 想再改点什么?跟我说一声</span>
        <span>→</span>
      </button>
    </div>
  )
}
