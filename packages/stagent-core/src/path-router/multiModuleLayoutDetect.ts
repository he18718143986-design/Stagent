/**
 * ADR: multiModuleLayout 检测 SSOT（Path Router + plan lint 共用）。
 *
 * 命中条件（AND）：
 *   taskType === 'software'
 *   AND pathLikeTokenCount(mergedText) >= 4
 *
 * pathLikeToken：含 `/` 的路径片段，或 `*.py` 文件名 token。
 */

const PATH_LIKE_RE = /(?:[a-zA-Z_][\w-]*\/)+|[a-zA-Z_][\w-]*\.py\b/g;

export const MULTI_MODULE_LAYOUT_MIN_TOKENS = 4;

/** 从文本中提取 path-like token（去重）。 */
export function extractPathLikeTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PATH_LIKE_RE)) {
    const t = m[0].trim();
    if (t.length >= 2) {
      found.add(t);
    }
  }
  return [...found];
}

export function countPathLikeTokens(text: string): number {
  return extractPathLikeTokens(text).length;
}

export interface MultiModuleLayoutInput {
  taskType?: string;
  userInput?: string;
  /** 工作区需求 md 等附加正文 */
  requirementText?: string;
}

/** software + ≥4 path-like tokens → 禁止 express / 须多模块切片计划。 */
export function detectMultiModuleLayout(input: MultiModuleLayoutInput): boolean {
  const taskType = (input.taskType ?? '').trim().toLowerCase();
  if (taskType !== 'software') {
    return false;
  }
  const merged = [input.userInput ?? '', input.requirementText ?? ''].filter(Boolean).join('\n');
  return countPathLikeTokens(merged) >= MULTI_MODULE_LAYOUT_MIN_TOKENS;
}

export function multiModuleLayoutSummary(input: MultiModuleLayoutInput): {
  detected: boolean;
  tokenCount: number;
  tokens: string[];
} {
  const merged = [input.userInput ?? '', input.requirementText ?? ''].filter(Boolean).join('\n');
  const tokens = extractPathLikeTokens(merged);
  return {
    detected: detectMultiModuleLayout(input),
    tokenCount: tokens.length,
    tokens: tokens.slice(0, 12),
  };
}
