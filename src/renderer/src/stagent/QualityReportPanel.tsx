import type { QualityReportPayload } from '@stagent/core'

export function QualityReportPanel({ report }: { report: QualityReportPayload }): JSX.Element {
  const { afk, verificationRows, engineSummary } = report
  return (
    <div className="border border-green-300 bg-stagent-surface rounded-lg p-4 text-sm space-y-3">
      <h3 className="font-semibold text-slate-100">质量报告</h3>
      <div
        className={`inline-block px-2 py-1 rounded text-xs font-medium ${
          afk.passed ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-800'
        }`}
      >
        AFK {afk.passed ? '通过' : '未通过'}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
        <div>稳定验证 {afk.stableVerificationPasses}/{afk.verificationStages}</div>
        <div>人工介入 {afk.humanInterventions}</div>
        <div>运行时重规划 {afk.runtimeReplanCount}</div>
        <div>
          DoD {afk.dodDeliverablesSatisfied}/{afk.dodDeliverablesTotal}
        </div>
        <div>Charter 覆盖 {(afk.charterCoverageRate * 100).toFixed(0)}%</div>
      </div>
      {verificationRows.length > 0 && (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-slate-400 border-b">
              <th className="py-1 pr-2">阶段</th>
              <th className="py-1 pr-2">通过/总计</th>
              <th className="py-1">状态</th>
            </tr>
          </thead>
          <tbody>
            {verificationRows.map((row) => (
              <tr key={row.stageId} className="border-b border-white/10">
                <td className="py-1 pr-2 font-mono">{row.stageId}</td>
                <td className="py-1 pr-2">
                  {row.passCount}/{row.totalRuns}
                </td>
                <td className="py-1">
                  {row.flaky ? '不稳定' : row.stable ? '稳定' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-slate-200 text-xs">{engineSummary}</p>
      {afk.reasons.length > 0 && (
        <ul className="text-xs text-red-300 list-disc pl-4 space-y-1">
          {afk.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
