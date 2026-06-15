/**
 * LLM token 用量计量器（缺口 3 · PRD-ENGINEER §4.4 成本计量）。
 *
 * 事实优先：厂商 usage（stream_options.include_usage）为准；
 * 厂商未下发时按 chars/4 估算并标记 estimated，绝不冒充精确值。
 *
 * 费用估算（可选）：设置环境变量
 *   LLM_PRICE_INPUT_PER_MTOK   每百万 prompt token 价格（任意货币，输出原样标注）
 *   LLM_PRICE_OUTPUT_PER_MTOK  每百万 completion token 价格
 * 未设置时报告省略 cost 字段（不假造）。
 */

const CHARS_PER_TOKEN_ESTIMATE = 4

/** @param {number} charCount */
export function estimateTokensFromChars(charCount) {
  return Math.ceil(Math.max(0, charCount) / CHARS_PER_TOKEN_ESTIMATE)
}

export function createLlmUsageMeter() {
  /** @type {Array<{model: string, role?: string, promptTokens: number, completionTokens: number, estimated: boolean}>} */
  const calls = []

  return {
    /**
     * @param {{ model: string, role?: string, promptTokens: number, completionTokens: number, estimated: boolean }} call
     */
    record(call) {
      calls.push(call)
    },

    summary() {
      if (calls.length === 0) {
        return undefined
      }
      const promptTokens = calls.reduce((s, c) => s + c.promptTokens, 0)
      const completionTokens = calls.reduce((s, c) => s + c.completionTokens, 0)
      const estimatedCalls = calls.filter((c) => c.estimated).length
      const byModel = {}
      const byRole = {}
      for (const c of calls) {
        const m = (byModel[c.model] ??= { calls: 0, promptTokens: 0, completionTokens: 0 })
        m.calls += 1
        m.promptTokens += c.promptTokens
        m.completionTokens += c.completionTokens
        const role = c.role ?? 'global'
        const r = (byRole[role] ??= { calls: 0, promptTokens: 0, completionTokens: 0 })
        r.calls += 1
        r.promptTokens += c.promptTokens
        r.completionTokens += c.completionTokens
      }
      const summary = {
        calls: calls.length,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCalls,
        byModel,
        byRole,
      }
      const inPrice = Number(process.env.LLM_PRICE_INPUT_PER_MTOK)
      const outPrice = Number(process.env.LLM_PRICE_OUTPUT_PER_MTOK)
      if (Number.isFinite(inPrice) && Number.isFinite(outPrice)) {
        summary.estimatedCost =
          Math.round(((promptTokens * inPrice + completionTokens * outPrice) / 1e6) * 1e4) / 1e4
      }
      return summary
    },
  }
}

/** 单行人类可读摘要（printHuman 用）。 */
export function formatUsageLine(summary) {
  if (!summary) return ''
  const est = summary.estimatedCalls > 0 ? ` (${summary.estimatedCalls} est.)` : ''
  const cost = summary.estimatedCost !== undefined ? `; cost≈${summary.estimatedCost}` : ''
  const roleBits =
    summary.byRole && Object.keys(summary.byRole).length > 1
      ? `; byRole ${Object.entries(summary.byRole)
          .map(([role, r]) => `${role}:${r.totalTokens ?? r.promptTokens + r.completionTokens}`)
          .join(', ')}`
      : ''
  return `llm: ${summary.calls} calls, in ${summary.promptTokens} / out ${summary.completionTokens} tok${est}${cost}${roleBits}`
}
