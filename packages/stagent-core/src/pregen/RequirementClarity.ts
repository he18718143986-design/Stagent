/** 口语化、无具体交付信号的短句 */
const VAGUE_SHORT =
  /^(?:做个|帮忙|弄一下|写一个|搞个|帮我|请|想要?).{0,28}$/iu;

/** 需求里已体现目标 / 验收 / 范围等可执行信号 */
const CLEAR_SIGNALS =
  /目标|验收|功能|实现|测试|pytest|单文件|模块|API|修复|重构|添加|创建|CLI|脚本|greet|计算器|交付|边界|技术栈|MVP|TDD|空目录/iu;

/** 高度含糊、需澄清决策的表述 */
const AMBIGUOUS_HEAVY = /不确定|随便|看着办|你决定|差不多就行|随便弄/iu;

/**
 * 判断用户自然语言是否「够清楚」，可跳过 LLM 澄清直接进入生成。
 * 工作区已有文件时的 q_files 决策题仍会保留。
 */
export function isRequirementClearEnough(userInput: string): boolean {
  const t = userInput.trim();
  if (!t) {
    return false;
  }
  if (t.length < 30) {
    return false;
  }
  if (VAGUE_SHORT.test(t)) {
    return false;
  }
  if (AMBIGUOUS_HEAVY.test(t) && !CLEAR_SIGNALS.test(t)) {
    return false;
  }
  if (t.length >= 80 && CLEAR_SIGNALS.test(t)) {
    return true;
  }
  if (/[1-9][.、)]/.test(t) && t.length >= 40 && CLEAR_SIGNALS.test(t)) {
    return true;
  }
  const clauseCount = (t.match(/[，。；：]/gu) || []).length;
  if (clauseCount >= 2 && t.length >= 45 && CLEAR_SIGNALS.test(t)) {
    return true;
  }
  if (t.length >= 55 && CLEAR_SIGNALS.test(t)) {
    return true;
  }
  return false;
}
