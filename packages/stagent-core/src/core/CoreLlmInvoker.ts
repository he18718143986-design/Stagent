import {
  buildLlmInvokePrompt,
  buildLlmRefusalRetryPrompt,
  formatLlmUserFacingError,
  createIdleTimeout,
} from '../LlmInvokeHelpers';
import { looksLikeRefusal } from '../WorkflowPrompts';
import { readLlmTimeoutMs, readPreferredModelByRole } from '../StagentSettings';
import { modelFamilyHintForStageId } from '../AgentSpecializationRouter';
import {
  appendStreamChunk,
  buildLlmStreamSummary,
  emptyStreamStats,
  type StreamStats,
} from '../StreamingSummary';
import type { BackendMessage } from '../WorkflowDefinition';
import type { LlmModel, LlmSendOptions, PlatformAdapter } from '../platform/PlatformAdapter';
import type { CoreDebugLogApi } from './CoreDebugLog';
import type { LlmInvokeOpts } from './LlmInvokeOpts';
import { readLlmMaxOutputTokens } from '../StagentSettings';

export interface CoreLlmInvokerDeps {
  platform: PlatformAdapter;
  getPreferredModelFamily(): string;
  sendBackendMessage(msg: BackendMessage): void;
  debug: Pick<CoreDebugLogApi, 'llmTraceLog' | 'logUserAction'>;
}

export type CoreLlmInvokeFn = (
  systemPrompt: string,
  userContent: string,
  traceStageId: string,
  opts?: LlmInvokeOpts,
) => Promise<string>;

/** 单个 LLM 调用遭遇瞬态网络错误时的最大重试次数（T4 Run #68 根治）。 */
export const MAX_TRANSIENT_LLM_RETRIES = 2;

const TRANSIENT_LLM_ERROR_RE =
  /(\b(terminated|econnreset|econnrefused|epipe|etimedout|enotfound|eai_again|socket hang ?up|fetch failed|network (?:error|timeout)|premature close|other side closed|stream (?:closed|aborted|errored)|connection (?:reset|closed|error))\b|und_err[a-z_]*)/i;

/**
 * 瞬态 LLM 错误（连接被掐断、网络抖动等），可安全重试。
 * 关键：排除我方 idle 超时触发的 abort（genuine 卡死，不应反复重试加倍等待）。
 * @param idleAborted 本次调用是否由 idle 超时主动 abort
 */
export function isTransientLlmError(err: unknown, idleAborted: boolean): boolean {
  if (idleAborted) {
    return false;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TRANSIENT_LLM_ERROR_RE.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createCoreLlmInvoker(deps: CoreLlmInvokerDeps): CoreLlmInvokeFn {
  /**
   * 按角色路由（M-异族出题人）：`stagent.llmModelByRole` 配置了当前 stage 角色
   * （如 test-write）的 family 且模型命中时优先使用；未配置 / 未命中一律回退
   * 全局 preferredModelFamily —— 零配置时与历史行为完全一致。
   */
  async function selectPreferredModels(traceStageId: string): Promise<LlmModel[]> {
    const roleHint = modelFamilyHintForStageId(
      traceStageId,
      readPreferredModelByRole(deps.platform.config),
    );
    if (roleHint) {
      const byRole = await deps.platform.llm.listModels({ family: roleHint });
      if (byRole.length > 0) {
        return byRole;
      }
    }
    return deps.platform.llm.listModels({ family: deps.getPreferredModelFamily() });
  }

  async function selectStructuredModels(traceStageId: string): Promise<LlmModel[]> {
    const preferred = await selectPreferredModels(traceStageId);
    if (preferred.length === 0 || preferred[0].structuredOutput !== false) {
      return preferred;
    }
    const capable = (await deps.platform.llm.listModels()).filter((m) => m.structuredOutput !== false);
    return capable.length > 0 ? capable : preferred;
  }

  function llmChannel(model: LlmModel): 'http' | 'lm-api' {
    return model.family.startsWith('direct:') ? 'http' : 'lm-api';
  }

  async function consumeLlmStream(
    stream: AsyncIterable<string>,
    channel: 'http' | 'lm-api',
    traceStageId: string,
    retried: boolean,
    onActivity?: () => void,
  ): Promise<string> {
    let full = '';
    let stats: StreamStats = emptyStreamStats();
    for await (const frag of stream) {
      onActivity?.();
      full += frag;
      stats = appendStreamChunk(stats, frag, new Date().toISOString());
      deps.sendBackendMessage({ type: 'streamChunk', stageId: traceStageId, chunk: frag });
    }
    deps.debug.logUserAction(
      'llm_stream_summary',
      buildLlmStreamSummary(traceStageId, stats, { retried, channel }),
    );
    return full;
  }

  async function invokeOnce(
    systemPrompt: string,
    userContent: string,
    traceStageId: string,
    idleMs: number,
    opts: LlmInvokeOpts | undefined,
  ): Promise<string> {
    const ac = new AbortController();
    let idleAborted = false;
    const idle = createIdleTimeout(idleMs, () => {
      idleAborted = true;
      ac.abort();
    });
    const onActivity = (): void => idle.reset();
    try {
      const apiKey = deps.platform.config.get<string>('llmApiKey', '').trim();
      if (deps.getPreferredModelFamily()?.startsWith('direct:') && !apiKey) {
        throw new Error('已选择「直接 API」模型但未配置 stagent.llmApiKey');
      }
      const models = opts?.requireStructured
        ? await selectStructuredModels(traceStageId)
        : await selectPreferredModels(traceStageId);
      if (models.length === 0) {
        throw new Error('未配置 GitHub Copilot 语言模型且无 stagent.llmApiKey，无法生成工作流');
      }
      const model = models[0];
      const channel = llmChannel(model);
      const resolvedMaxTokens =
        typeof opts?.maxTokens === 'number' && Number.isFinite(opts.maxTokens)
          ? Math.floor(opts.maxTokens)
          : opts?.jsonMode
            ? readLlmMaxOutputTokens(deps.platform.config)
            : undefined;
      const sendOptions: LlmSendOptions = {
        onActivity,
        ...(opts?.jsonMode ? { jsonMode: true } : {}),
        ...(resolvedMaxTokens != null ? { maxTokens: resolvedMaxTokens } : {}),
      };
      const prompt = buildLlmInvokePrompt(systemPrompt, userContent);
      deps.debug.llmTraceLog(traceStageId, 'llm_start', {
        model: model.family,
        requireStructured: !!opts?.requireStructured,
        jsonMode: !!opts?.jsonMode,
        ...(resolvedMaxTokens != null ? { maxTokens: resolvedMaxTokens } : {}),
        promptChars: prompt.length,
      });
      let full = await consumeLlmStream(
        model.sendRequest([{ role: 'user', content: prompt }], sendOptions, ac.signal),
        channel,
        traceStageId,
        false,
        onActivity,
      );
      if (!full.trim()) {
        const emptyRetryPrompt = `${prompt}\n\n【系统】上次响应为空。请直接输出完整正文，禁止空回复。`;
        const retried = await consumeLlmStream(
          model.sendRequest([{ role: 'user', content: emptyRetryPrompt }], sendOptions, ac.signal),
          channel,
          traceStageId,
          true,
          onActivity,
        );
        if (retried.trim().length > 0) {
          deps.debug.llmTraceLog(traceStageId, 'llm_end', {
            model: model.family,
            emptyRetry: true,
            responseChars: retried.length,
            preview: retried.slice(0, 200),
          });
          full = retried;
        }
      }
      if (looksLikeRefusal(full)) {
        const retryPrompt = buildLlmRefusalRetryPrompt(prompt);
        const retried = await consumeLlmStream(
          model.sendRequest([{ role: 'user', content: retryPrompt }], sendOptions, ac.signal),
          channel,
          traceStageId,
          true,
          onActivity,
        );
        if (!looksLikeRefusal(retried) && retried.trim().length > 0) {
          deps.debug.llmTraceLog(traceStageId, 'llm_end', {
            model: model.family,
            refusalRetry: true,
            responseChars: retried.length,
            preview: retried.slice(0, 200),
          });
          return retried;
        }
      }
      deps.debug.llmTraceLog(traceStageId, 'llm_end', {
        model: model.family,
        responseChars: full.length,
        preview: full.slice(0, 200),
      });
      return full;
    } catch (e) {
      // 区分瞬态网络错误（可重试）与 idle 超时/其它（不重试）：交由上层判定
      if (e instanceof Error && !idleAborted && isTransientLlmError(e, false)) {
        const transient = new TransientLlmError(e.message);
        transient.cause = e;
        throw transient;
      }
      throw e;
    } finally {
      idle.clear();
    }
  }

  return async function invokeLlmRaw(
    systemPrompt: string,
    userContent: string,
    traceStageId: string,
    opts?: LlmInvokeOpts,
  ): Promise<string> {
    const idleMs = readLlmTimeoutMs(deps.platform.config);
    let lastErr: unknown;
    // 瞬态网络错误（连接被掐断等）重试：一次掉线不应让 ~30 次调用的整轮 T4 失败（Run #68）。
    for (let attempt = 0; attempt <= MAX_TRANSIENT_LLM_RETRIES; attempt++) {
      try {
        return await invokeOnce(systemPrompt, userContent, traceStageId, idleMs, opts);
      } catch (e) {
        const transient = e instanceof TransientLlmError;
        lastErr = transient ? (e as TransientLlmError).cause ?? e : e;
        deps.debug.llmTraceLog(traceStageId, 'llm_error', {
          error: lastErr instanceof Error ? lastErr.message : String(lastErr),
          attempt,
          transient,
          willRetry: transient && attempt < MAX_TRANSIENT_LLM_RETRIES,
        });
        if (transient && attempt < MAX_TRANSIENT_LLM_RETRIES) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error(formatLlmUserFacingError(lastErr, idleMs));
      }
    }
    // 不可达：循环要么 return 要么 throw
    throw new Error(formatLlmUserFacingError(lastErr, idleMs));
  };
}

/** 内部哨兵：标记可重试的瞬态 LLM 错误，携带原始 cause 供最终用户文案使用。 */
class TransientLlmError extends Error {
  cause?: unknown;
  constructor(message: string) {
    super(message);
    this.name = 'TransientLlmError';
  }
}
