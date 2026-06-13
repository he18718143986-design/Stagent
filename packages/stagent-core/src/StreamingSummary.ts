/**
 * StreamingSummary
 * ----------------
 * LLM 流式输出累计纯函数：M14.3 落地 SPEC §9.1 I-22 的可追溯环节。
 *
 * 问题：`invokeLlmRaw` / DirectHttpLmModel 等流式路径下，每条 `streamChunk` 都进
 * `.wf-debug.log` 会产生大量噪声；但不进 → 阶段结束后无法追溯模型输出体量。
 *
 * 方案：调用方维护一个 StreamStats，每收到 chunk 调 `appendStreamChunk`；阶段
 * 结束时调 `buildLlmStreamSummary` 拿到 `{ chars, chunkCount, ... }` 一次性写
 * 一条 `user_action` 行（kind=`llm_stream_summary`）。
 *
 * 纯函数，零依赖；既能在引擎里复用，又能独立单测。
 */

export interface StreamStats {
  /** 累计字符数（按 JS string .length 计；约等于 UTF-16 code units，不是字节数） */
  chars: number;
  /** chunk 计数（即模型流式 token 批次数，与具体 tokenizer 无关） */
  chunkCount: number;
  /** 首批 chunk 时间戳（ISO 8601）；未收到任何 chunk 时为 undefined */
  firstChunkAt?: string;
  /** 末批 chunk 时间戳（ISO 8601） */
  lastChunkAt?: string;
}

export function emptyStreamStats(): StreamStats {
  return { chars: 0, chunkCount: 0 };
}

export function appendStreamChunk(stats: StreamStats, chunk: string, nowIso: string): StreamStats {
  const c = typeof chunk === 'string' ? chunk : '';
  return {
    chars: stats.chars + c.length,
    chunkCount: stats.chunkCount + 1,
    firstChunkAt: stats.firstChunkAt ?? nowIso,
    lastChunkAt: nowIso,
  };
}

export interface LlmStreamSummaryPayload {
  // 索引签名让该 payload 直接兼容 logUserAction 的 Record<string, unknown> 第二参数，
  // 避免调用点写 `as unknown as Record<...>`。
  [key: string]: unknown;
  stageId: string;
  chars: number;
  chunkCount: number;
  firstChunkAt?: string;
  lastChunkAt?: string;
  /** 标记是否为 invokeLlmRaw 中 looksLikeRefusal 触发的二次重试（true=重试段，false/undefined=首次） */
  retried?: boolean;
  /** 标记调用通道（'lm-api' = vscode.lm；'http' = OpenAI 兼容 HTTP） */
  channel?: 'lm-api' | 'http';
}

export function buildLlmStreamSummary(
  stageId: string,
  stats: StreamStats,
  meta?: { retried?: boolean; channel?: 'lm-api' | 'http' },
): LlmStreamSummaryPayload {
  return {
    stageId,
    chars: stats.chars,
    chunkCount: stats.chunkCount,
    firstChunkAt: stats.firstChunkAt,
    lastChunkAt: stats.lastChunkAt,
    retried: meta?.retried,
    channel: meta?.channel,
  };
}
