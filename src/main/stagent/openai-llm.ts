/* ------------------------------------------------------------------ */
/*  openai-llm.ts — 中立 LlmModel 的 OpenAI 兼容 HTTP 实现（Electron 侧）  */
/*                                                                     */
/*  实现 @stagent/core 的 LlmModel 接口：sendRequest 直接返回文本增量    */
/*  异步流（复用 core 的 parseSseDeltaStream 解析 SSE）。                 */
/*  作为提供方链的「真实 API」一档；:8787 本地降级见 provider-chain.ts。 */
/* ------------------------------------------------------------------ */

import { parseSseDeltaStream, type LlmMessage, type LlmModel, type LlmSendOptions } from '@stagent/core'
import { LlmHttpError } from './provider-chain'

export interface OpenAiHttpModelConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxOutputTokens: number
}

/**
 * OpenAI 兼容 HTTP 模型（OpenAI / DeepSeek / 任意 /v1/chat/completions 兼容端点）。
 * family 统一带 `direct:` 前缀，使引擎走 HTTP channel（与 VS Code 直接 API 路径一致）。
 */
export class OpenAiHttpLlmModel implements LlmModel {
  readonly id: string
  readonly family: string
  readonly name: string
  /** 真实 API：JSON / 参数约束可靠（generateWorkflow、决策阶段优先选它）。 */
  readonly structuredOutput = true

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly maxOutputTokens: number

  constructor(cfg: OpenAiHttpModelConfig) {
    this.apiKey = cfg.apiKey
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '')
    this.model = cfg.model
    this.maxOutputTokens = cfg.maxOutputTokens
    this.family = `direct:${cfg.model}`
    this.id = `stagent-direct-http:${cfg.model}`
    this.name = `⚡ ${cfg.model}（直接 API）`
  }

  async *sendRequest(
    messages: LlmMessage[],
    options: LlmSendOptions | undefined,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const maxTokens =
      typeof options?.maxTokens === 'number' && Number.isFinite(options.maxTokens)
        ? Math.floor(options.maxTokens)
        : this.maxOutputTokens

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        max_tokens: maxTokens,
        ...(typeof options?.temperature === 'number' ? { temperature: options.temperature } : {}),
        // #2 治本：JSON 阶段启用结构化输出（OpenAI 兼容端点）。提示中已含 "JSON" 字样。
        ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new LlmHttpError(`LLM API 请求失败 [${res.status}]: ${errText.slice(0, 500)}`, res.status)
    }
    const body = res.body
    if (!body) {
      throw new Error('LLM API 响应无 body')
    }
    // 透传存活回调：推理模型作答前的思维链（reasoning_content）流量也会重置
    // 引擎的空闲超时，避免长思考被误判卡死中断。
    yield* parseSseDeltaStream(body, signal, options?.onActivity)
  }
}
