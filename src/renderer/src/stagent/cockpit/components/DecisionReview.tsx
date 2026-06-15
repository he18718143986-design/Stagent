import React, { useEffect, useRef, useState } from 'react'

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
    <div className="space-y-2 border border-purple-200 bg-purple-50 rounded-lg p-3 mt-2">
      <div className="text-sm font-medium text-purple-800">决策评审 — 填写决策记录后批准</div>
      <textarea
        className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y min-h-[6rem] font-mono"
        placeholder="记录此处所做的关键决策、取舍与依据…"
        value={record}
        onChange={(e) => {
          userEdited.current = true
          setRecord(e.target.value)
        }}
      />
      <div className="rounded border border-purple-100 bg-white p-2">
        <div className="text-xs font-medium text-gray-600 mb-1">
          结构自检（{checks.length - uncheckedCount}/{checks.length}）
        </div>
        <ul className="space-y-0.5">
          {checks.map((c) => (
            <li key={c.label} className="text-xs flex items-start gap-1.5">
              <span className={c.ok ? 'text-green-600' : 'text-amber-500'}>{c.ok ? '✓' : '○'}</span>
              <span className={c.ok ? 'text-gray-500' : 'text-gray-700'}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="text-sm bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
          disabled={!record.trim()}
          onClick={() => onApprove(record.trim())}
        >
          批准决策并继续
        </button>
        <button
          type="button"
          className="text-sm border border-purple-400 text-purple-700 px-3 py-1.5 rounded hover:bg-purple-100 disabled:opacity-50"
          disabled={!record.trim() || reviewing}
          onClick={() => void runReview()}
        >
          {reviewing ? 'AI 复核中…' : '🔍 AI 复核'}
        </button>
        {uncheckedCount > 0 && (
          <span className="text-xs text-amber-600">还有 {uncheckedCount} 条结构项未满足（可忽略直接批准）</span>
        )}
      </div>
      {reviewErr && (
        <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded px-2 py-1">
          AI 复核失败：{reviewErr}
        </div>
      )}
      {review && (
        <div className="text-xs text-gray-800 border border-blue-200 bg-blue-50 rounded px-2 py-2 whitespace-pre-wrap">
          <div className="font-medium text-blue-700 mb-1">
            AI 复核意见{reviewModel ? `（${reviewModel}）` : ''}
          </div>
          {review}
        </div>
      )}
    </div>
  )
}
