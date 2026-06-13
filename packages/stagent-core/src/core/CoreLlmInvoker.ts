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

  return async function invokeLlmRaw(
    systemPrompt: string,
    userContent: string,
    traceStageId: string,
    opts?: LlmInvokeOpts,
  ): Promise<string> {
    const idleMs = readLlmTimeoutMs(deps.platform.config);
    const ac = new AbortController();
    const idle = createIdleTimeout(idleMs, () => ac.abort());
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
      deps.debug.llmTraceLog(traceStageId, 'llm_error', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw new Error(formatLlmUserFacingError(e, idleMs));
    } finally {
      idle.clear();
    }
  };
}
