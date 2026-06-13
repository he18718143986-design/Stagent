import { scanBalancedJsonFromIndex } from './JsonScanState';

/** OpenAI 兼容 finish_reason：'length' 表示因 max_tokens 截断。 */
export type LlmFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | string | undefined;

/**
 * 粗判 JSON 是否被截断（#1）：
 * - 若已知 `finishReason === 'length'`（模型因 max_tokens 截断），直接判定截断，最可靠；
 * - 否则剥离围栏后从首个 `{`/`[` 起扫描括号深度，未归零（或停在字符串内）视为截断。
 *   括号扫描作为 finishReason 不可得时的兜底。
 */
export function isLikelyTruncatedJson(raw: string, finishReason?: LlmFinishReason): boolean {
  if (finishReason === 'length') {
    return true;
  }
  const fenced = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)).map((m) => m[1].trim());
  const text = (fenced.length > 0 ? fenced[fenced.length - 1] : raw).trim();
  const startIdx = text.search(/[{[]/);
  if (startIdx === -1) {
    return false;
  }
  const { inString, depth } = scanBalancedJsonFromIndex(text, startIdx);
  return inString || depth > 0;
}
