import { parseSseDeltaStream } from '@stagent/core'
import { normalizeLlmBaseUrl } from './normalize-base-url.mjs'
import { estimateTokensFromChars } from './llm-usage.mjs'

/**
 * Minimal OpenAI-compatible HTTP LlmModel (mirrors src/main/stagent/openai-llm.ts).
 * @param {{ apiKey: string, baseUrl: string, model: string, maxOutputTokens: number,
 *           usageMeter?: { record(call: object): void } }} cfg
 */
export function createOpenAiHttpLlmModel(cfg) {
  const baseUrl = normalizeLlmBaseUrl(cfg.baseUrl)
  const family = `direct:${cfg.model}`

  return {
    id: `stagent-direct-http:${cfg.model}`,
    family,
    name: `⚡ ${cfg.model}（直接 API）`,
    structuredOutput: true,
    async *sendRequest(messages, options, signal) {
      const maxTokens =
        typeof options?.maxTokens === 'number' && Number.isFinite(options.maxTokens)
          ? Math.floor(options.maxTokens)
          : cfg.maxOutputTokens

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          // token 计量：要求厂商在末尾 chunk 下发 usage（OpenAI 兼容扩展；不支持的厂商忽略该字段）
          ...(cfg.usageMeter ? { stream_options: { include_usage: true } } : {}),
          max_tokens: maxTokens,
          ...(typeof options?.temperature === 'number' ? { temperature: options.temperature } : {}),
          ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`LLM API 请求失败 [${res.status}]: ${errText.slice(0, 500)}`)
      }
      const body = res.body
      if (!body) {
        throw new Error('LLM API 响应无 body')
      }
      if (!cfg.usageMeter) {
        yield* parseSseDeltaStream(body, signal, options?.onActivity)
        return
      }

      let reportedUsage = null
      let outputChars = 0
      try {
        for await (const delta of parseSseDeltaStream(body, signal, options?.onActivity, (u) => {
          reportedUsage = u
        })) {
          outputChars += delta.length
          yield delta
        }
      } finally {
        // 厂商 usage 为准；缺失（mock / 不支持 include_usage 的端点）则按字符估算并标记。
        const promptTokens =
          reportedUsage?.prompt_tokens ?? estimateTokensFromMessages(messages)
        const completionTokens =
          reportedUsage?.completion_tokens ?? estimateTokensFromChars(outputChars)
        cfg.usageMeter.record({
          model: cfg.model,
          promptTokens,
          completionTokens,
          estimated: reportedUsage == null,
        })
      }
    },
  }
}

function estimateTokensFromMessages(messages) {
  let chars = 0
  for (const m of messages) {
    chars += typeof m.content === 'string' ? m.content.length : 0
  }
  return estimateTokensFromChars(chars)
}
