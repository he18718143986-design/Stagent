/**
 * 生成前澄清 `q_files`「如何处理已有文件」选项 ↔ reuseStrategy 的**单一事实源**（#16）。
 *
 * 选项文案与解析映射都从同一数组派生：措辞调整时两侧同步更新，避免「改了选项原文 → 映射静默断裂」
 * （原 `answer.includes('逐个')` 模糊子串匹配的脆弱性）。纯模块，无 vscode 依赖，便于 node:test 单测。
 *
 * 注：彻底的结构化方案是让前端按 `value`（枚举）而非选项原文回传（需改 clarify 问答协议），列为后续。
 */

export type ReuseStrategy = 'regenerate' | 'reuse-all' | 'reuse-partial';

export const REUSE_STRATEGY_OPTIONS: ReadonlyArray<{ value: ReuseStrategy; label: string }> = [
  { value: 'regenerate', label: '重新生成（覆盖已有文件）' },
  { value: 'reuse-all', label: '复用已有文件（跳过生成）' },
  { value: 'reuse-partial', label: '逐个确认（部分复用）' },
];

/** q_files 答案（选项原文）→ reuseStrategy；以选项常量精确匹配（label 或 value），未知/空 → regenerate。 */
export function resolveReuseStrategyFromClarify(answer: string | undefined): ReuseStrategy {
  const a = (answer ?? '').trim();
  if (!a) {
    return 'regenerate';
  }
  const exact = REUSE_STRATEGY_OPTIONS.find((o) => o.label === a || o.value === a);
  return exact ? exact.value : 'regenerate';
}
