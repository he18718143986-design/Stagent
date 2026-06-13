import type { JsonCandidate } from './JsonScanState';
import { collectBalancedJsonCandidates } from './collectCandidates';
import { isLikelyTruncatedJson } from './truncateCheck';
import { iterMarkdownFencedBlocks } from '../markdown/MarkdownFenceUtils';

function pickFirstValidJson(
  text: string,
  accept: (c: JsonCandidate) => boolean,
): string | undefined {
  for (const candidate of collectBalancedJsonCandidates(text)) {
    if (!accept(candidate)) {
      continue;
    }
    try {
      JSON.parse(candidate.text);
      return candidate.text;
    } catch {
      // keep searching for next valid candidate
    }
  }
  return undefined;
}

function stripFencesAndPick(
  raw: string,
  accept: (c: JsonCandidate) => boolean,
): string | undefined {
  const fenced = iterMarkdownFencedBlocks(raw);
  for (const block of fenced) {
    const parsed = pickFirstValidJson(block, accept);
    if (parsed) {
      return parsed;
    }
  }
  return pickFirstValidJson(raw.trim(), accept);
}

/** 提取首个合法 JSON 对象（`{...}`）。剥离 markdown 围栏，忽略前后散文。 */
export function extractJsonObject(raw: string): string | undefined {
  return stripFencesAndPick(raw, (c) => c.opener === '{');
}

/** 提取首个合法 JSON 值（对象或数组）。用于 PatchInstruction[] 等数组输出。 */
export function extractJsonValue(raw: string): string | undefined {
  return stripFencesAndPick(raw, () => true);
}

export { isLikelyTruncatedJson };
