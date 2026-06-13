import { createJsonScanState, stepJsonScan, type JsonCandidate } from './JsonScanState';

/** 扫描出顶层平衡的 JSON 片段（对象 `{...}` 与数组 `[...]`），忽略字符串内的括号。 */
export function collectBalancedJsonCandidates(text: string): JsonCandidate[] {
  const out: JsonCandidate[] = [];
  const state = createJsonScanState();

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const sliceStart = state.start;
    const hit = stepJsonScan(state, ch, i);
    if (hit && sliceStart >= 0) {
      out.push({ text: text.slice(sliceStart, i + 1), opener: hit.opener });
    }
  }

  return out;
}

export type { JsonCandidate };
