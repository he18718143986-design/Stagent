import React, { useEffect, useMemo, useRef, useState } from 'react'
import { extractDecisionAssumptions } from '../derive/decisionRecordSections'

function computeDecisionChecks(text: string): { label: string; ok: boolean }[] {
  const scenarioCount = (text.match(/场景\s*[0-9一二三四五六七八九十]/g) || []).length
  const hasConflictCheck = /已检查：|潜在冲突：/.test(text)
  return [
    { label: '每条决策是否说明了“为什么不选备选方案”？', ok: /而非|备选|不选/.test(text) },
    { label: '“边界压力测试”节是否包含至少 2 个具体场景？', ok: scenarioCount >= 2 },
    { label: '“AI 无法验证的假设”节是否至少有 1 条？', ok: /AI 无法验证的假设/.test(text) },
    { label: '总字数是否 ≤ 800 字？', ok: text.length <= 800 },
    { label: '是否未混入代码（决策记录不应有代码）？', ok: !/function\s|class\s|const\s|let\s|var\s|=>/.test(text) },
    { label: '若涉及已有代码，是否标注了冲突检测结果？', ok: hasConflictCheck },
  ]
}

export function DecisionReview({
  stageId,
  onApprove,
  onReview,
  initialRecord = '',
}: {
  stageId: string
  onApprove: (decisionRecord: string) => void
  onReview: (
    stageId: string,
    decisionRecord: string,
  ) => Promise<{ ok: boolean; review?: string; model?: string; error?: string }>
  /** 决策阶段 LLM 已生成的决策记录,预填到文本框供用户审阅/修改后批准。 */
  initialRecord?: string
}): React.JSX.Element {
  const [record, setRecord] = useState(initialRecord)
  const userEdited = useRef(false)

  // 决策记录可能在挂载后才到达(stageOutput 晚于 paused 状态);用户未手动改过时跟随预填。
  useEffect(() => {
    if (!userEdited.current && initialRecord && !record) {
      setRecord(initialRecord)
    }
  }, [initialRecord, record])
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState<string | null>(null)
  const [reviewErr, setReviewErr] = useState<string | null>(null)
  const [reviewModel, setReviewModel] = useState<string | null>(null)

  const checks = computeDecisionChecks(record)
  const uncheckedCount = checks.filter((c) => !c.ok).length

  // 逼出判断 #1:AI 无法替你核实的假设/风险,须逐条勾选「已知悉」后才能批准。
  const assumptions = useMemo(() => extractDecisionAssumptions(record), [record])
  const [acked, setAcked] = useState<Record<string, boolean>>({})
  const allAcked = assumptions.every((a) => acked[a])
  // 逼出判断 #2:结构自检未满足时,「批准」需二次确认,不能一键放行。
  const [confirming, setConfirming] = useState(false)

  const canApprove = !!record.trim() && allAcked

  const handleApprove = (): void => {
    if (!canApprove) {
      return
    }
    if (uncheckedCount > 0 && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onApprove(record.trim())
  }

  const runReview = async (): Promise<void> => {
    setReviewing(true)
    setReview(null)
    setReviewErr(null)
    try {
      const res = await onReview(stageId, record.trim())
      if (res.ok) {
        setReview(res.review ?? '(无返回)')
        setReviewModel(res.model ?? null)
      } else {
        setReviewErr(res.error ?? 'review-failed')
      }
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : String(e))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="space-y-2 border border-purple-500/30 bg-purple-500/10 rounded-lg p-3 mt-2">
      <div className="text-sm font-medium text-purple-200">决策评审 — 填写决策记录后批准</div>
      <textarea
        className="w-full text-sm border border-white/15 rounded px-2 py-1 resize-y min-h-[6rem] font-mono"
        placeholder="记录此处所做的关键决策、取舍与依据…"
        value={record}
        onChange={(e) => {
          userEdited.current = true
          setRecord(e.target.value)
        }}
      />
      <div className="rounded border border-white/10 bg-white/5 p-2">
        <div className="text-xs font-medium text-slate-300 mb-1">
          结构自检（{checks.length - uncheckedCount}/{checks.length}）
        </div>
        <ul className="space-y-0.5">
          {checks.map((c) => (
            <li key={c.label} className="text-xs flex items-start gap-1.5">
              <span className={c.ok ? 'text-green-400' : 'text-amber-400'}>{c.ok ? '✓' : '○'}</span>
              <span className={c.ok ? 'text-slate-500' : 'text-slate-300'}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {assumptions.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
          <div className="text-xs font-medium text-amber-200 mb-1">
            批准前请逐条知悉（AI 无法替你核实，需你担责）
          </div>
          <ul className="space-y-1">
            {assumptions.map((a) => (
              <li key={a} className="text-xs flex items-start gap-1.5">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-amber-500 shrink-0"
                  checked={!!acked[a]}
                  onChange={(e) => setAcked((m) => ({ ...m, [a]: e.target.checked }))}
                />
                <span className="text-slate-300">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="text-sm bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
          disabled={!canApprove}
          onClick={handleApprove}
        >
          批准决策并继续
        </button>
        <button
          type="button"
          className="text-sm border border-purple-400/60 text-purple-300 px-3 py-1.5 rounded hover:bg-purple-500/15 disabled:opacity-50"
          disabled={!record.trim() || reviewing}
          onClick={() => void runReview()}
        >
          {reviewing ? 'AI 复核中…' : '🔍 AI 复核'}
        </button>
        {!allAcked && assumptions.length > 0 && (
          <span className="text-xs text-amber-400">请先勾选上面的「已知悉」</span>
        )}
      </div>
      {confirming && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 space-y-2">
          <div className="text-xs text-amber-200">
            这份方案还有 {uncheckedCount} 项没满足（{checks.filter((c) => !c.ok).map((c) => c.label).join('；')}）。仍要批准吗？
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-sm bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700"
              onClick={() => {
                setConfirming(false)
                onApprove(record.trim())
              }}
            >
              仍要批准
            </button>
            <button
              type="button"
              className="text-sm border border-white/15 text-slate-300 px-3 py-1.5 rounded hover:bg-white/5"
              onClick={() => setConfirming(false)}
            >
              再改改
            </button>
          </div>
        </div>
      )}
      {reviewErr && (
        <div className="text-xs text-red-300 border border-red-500/30 bg-red-500/10 rounded px-2 py-1">
          AI 复核失败：{reviewErr}
        </div>
      )}
      {review && (
        <div className="text-xs text-slate-200 border border-blue-500/30 bg-blue-500/10 rounded px-2 py-2 whitespace-pre-wrap">
          <div className="font-medium text-blue-300 mb-1">
            AI 复核意见{reviewModel ? `（${reviewModel}）` : ''}
          </div>
          {review}
        </div>
      )}
    </div>
  )
}
