/* ------------------------------------------------------------------ */
/*  provider-chain.ts — LLM 提供方链：真实 API 优先，:8787 本地降级       */
/*                                                                     */
/*  - LocalAdapterLlmModel：对接 autoAI 本地 OpenAI 兼容适配器           */
/*    (http://127.0.0.1:8787)，经浏览器自动化免 API Key。该端点          */
/*    /v1/chat/completions 为「非流式」，整段文本一次性返回。            */
/*  - ProviderChainLlmModel：把多个委托模型串成「优先级链」。            */
/*    sendRequest 依次尝试；仅在「首块产出之前」失败时降级到下一个，     */
/*    已开始流式输出后出错则直接抛出（不能中途切换提供方）。             */
/* ------------------------------------------------------------------ */

import type { LlmMessage, LlmModel, LlmSendOptions } from '@stagent/core'

interface LocalChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

/** 携带 HTTP 状态码的错误，便于链路精确识别 429/503 等配额/限流信号。 */
export class LlmHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'LlmHttpError'
  }
}

/**
 * 判断错误是否为「配额耗尽 / 限流 / 服务暂不可用」——这类错误意味着
 * 该 provider 短期内不应再被尝试，应冷却拉黑并切换到链路中的下一个。
 */
export function isQuotaOrRateLimitError(err: unknown): boolean {
  const status = err instanceof LlmHttpError ? err.status : (err as { status?: number } | null)?.status
  if (status === 429 || status === 503) {
    return true
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    /\b(429|503)\b/.test(msg) ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('exhaust') ||
    msg.includes('insufficient_quota') ||
    msg.includes('too many requests') ||
    msg.includes('unhealthy')
  )
}

/**
 * 缺口3 — 任务路由信号。引擎在「期望严格 JSON」的调用上传 `jsonMode:true`
 * （generateWorkflow / clarify 等），据此把可靠 provider 排前、网页 AI 降级。
 * 与 LlmSendOptions 结构兼容，可直接把 options 传入。
 */
export interface ChainTask {
  jsonMode?: boolean
}

/** 稳定排序：按 rank 升序，rank 相同保留原始顺序（保持配置优先级）。 */
function stableSortBy<T>(arr: readonly T[], rank: (t: T) => number): T[] {
  return arr
    .map((v, i) => [v, i] as const)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([v]) => v)
}

/**
 * 缺口3 — 按任务对委托排序（带能力标签的有序链 + 按任务动态排序）。
 * 取代「fresh 全量 + cooled 兜底」的扁平顺序：
 *   1. 冷却中的 provider 永远排到最后（仅在全链不可用时兜底再试一遍）。
 *   2. 结构化任务（task.jsonMode）下，把不可靠产出结构化的网页自动化 AI
 *      （structuredOutput === false）降级到「未冷却组」的末位，可靠 provider 优先。
 *   3. 非结构化任务保持配置优先级（真实 API 优先、本地降级）。
 * 稳定排序，确保同档内顺序与传入 delegates 一致。
 */
export function orderDelegatesForTask(
  delegates: readonly LlmModel[],
  task: ChainTask | undefined,
  cooldown?: QuotaCooldownRegistry,
  now: number = Date.now(),
): LlmModel[] {
  const fresh = delegates.filter((d) => !cooldown?.isCooled(d.family, now))
  const cooled = delegates.filter((d) => cooldown?.isCooled(d.family, now))
  const orderedFresh = task?.jsonMode
    ? stableSortBy(fresh, (d) => (d.structuredOutput === false ? 1 : 0))
    : [...fresh]
  return [...orderedFresh, ...cooled]
}

const DEFAULT_COOLDOWN_MS = 60_000

/**
 * 配额冷却注册表（#3）：记录因 429/限流被拉黑的 provider family 及其解冻时刻。
 * 必须跨多次 listModels()/sendRequest() 调用存活，故由 ElectronLlmPort 持有一份并注入链路。
 */
export class QuotaCooldownRegistry {
  private readonly until = new Map<string, number>()

  constructor(private readonly ttlMs: number = DEFAULT_COOLDOWN_MS) {}

  markCooldown(family: string, now: number = Date.now()): void {
    this.until.set(family, now + this.ttlMs)
  }

  isCooled(family: string, now: number = Date.now()): boolean {
    const t = this.until.get(family)
    if (t === undefined) {
      return false
    }
    if (now >= t) {
      this.until.delete(family)
      return false
    }
    return true
  }
}

/**
 * 本地适配器模型（family `local:<modelId>`）。
 * 非流式：POST /v1/chat/completions → 取 choices[0].message.content，作为单块产出。
 */
export class LocalAdapterLlmModel implements LlmModel {
  readonly id: string
  readonly family: string
  readonly name: string
  /** 浏览器自动化网页 AI：JSON 保真度低、无 temperature/max_tokens → 结构化不可靠。 */
  readonly structuredOutput = false

  constructor(
    private readonly baseUrl: string,
    private readonly modelId: string,
    label: string,
  ) {
    this.family = `local:${modelId}`
    this.id = `stagent-local:${modelId}`
    this.name = `🌐 ${label || modelId}（本地浏览器）`
  }

  async *sendRequest(
    messages: LlmMessage[],
    _options: LlmSendOptions | undefined,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
      signal,
    })
    const data = (await res.json().catch(() => ({}))) as LocalChatCompletion
    if (!res.ok) {
      const msg = data?.error?.message ?? `状态 ${res.status}`
      throw new LlmHttpError(`本地适配器请求失败：${msg}`, res.status)
    }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (text) {
      yield text
    }
  }
}

/**
 * 优先级链模型：按 delegates 顺序尝试，首块产出前失败则降级到下一个。
 * family `chain:auto`，作为默认首选（真实 API 优先、本地适配器降级）。
 */
export class ProviderChainLlmModel implements LlmModel {
  readonly id = 'stagent-chain:auto'
  readonly family = 'chain:auto'
  readonly name = '🔀 自动（真实 API 优先 · 本地降级）'
  /**
   * 复合链路可能降级到本地网页 AI，故对「结构化阶段」视为不可靠：
   * 引擎会改选纯 `direct:`（无本地兜底），确保 JSON / 决策阶段不下发到 :8787。
   */
  readonly structuredOutput = false

  constructor(
    private readonly delegates: LlmModel[],
    private readonly cooldown?: QuotaCooldownRegistry,
  ) {}

  async *sendRequest(
    messages: LlmMessage[],
    options: LlmSendOptions | undefined,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    // 缺口3：按任务路由 + 降级排序——结构化任务把可靠 provider 排前、网页 AI 降级，
    // 冷却中的（#3 配额拉黑）始终兜底到最后。
    const order = orderDelegatesForTask(this.delegates, options, this.cooldown)

    let lastErr: unknown
    for (const delegate of order) {
      let yielded = false
      try {
        for await (const chunk of delegate.sendRequest(messages, options, signal)) {
          yielded = true
          yield chunk
        }
        return // 该委托成功完成
      } catch (err) {
        // 已开始流式 / 已被取消：无法切换提供方，直接抛出。
        if (yielded || signal.aborted) {
          throw err
        }
        // 配额/限流：拉黑该 provider 一段时间，避免后续重复撞墙。
        if (isQuotaOrRateLimitError(err)) {
          this.cooldown?.markCooldown(delegate.family)
        }
        lastErr = err // 首块前失败 → 尝试链路中的下一个提供方
      }
    }
    throw lastErr ?? new Error('LLM 提供方链中无可用模型')
  }
}
