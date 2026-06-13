/** 输入页生成/润色进度文案（纯函数，便于单测） */

export function formatStreamCharSuffix(charCount: number): string {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return '';
  }
  return ` · 已接收约 ${charCount} 字`;
}

/** 去掉详情文案中已追加的流式字数后缀（可多次出现，用于从 DOM 恢复 base） */
export function stripStreamCharSuffix(text: string): string {
  return text.replace(/\s·\s已接收约 \d+ 字/g, '').trimEnd();
}

export function buildLlmWaitingDetail(taskTypeAuto: boolean): string {
  const typeHint = taskTypeAuto
    ? '将同时判断 taskType 并生成完整工作流 JSON。'
    : '正在生成完整工作流 JSON。';
  return `${typeHint} DeepSeek 等 API 通常需 1～3 分钟；首字出现前页面可能仅有阶段提示，属正常现象。`;
}

export const INPUT_PAGE_BUSY_TITLES = {
  workflowSubmitted: '正在生成工作流',
  polishSubmitted: '正在润色需求',
  clarifySubmitted: '正在生成澄清问题',
  workflowPreparing: '正在准备工作区上下文',
  workflowLlm: '正在调用模型',
  workflowValidating: '正在校验与后处理',
} as const;
