/** B-R3：术语 → 白话（G3）；供确认页 / 反馈环 / 里程碑提示复用。 */

export const PLAIN_TASK_TYPE_LABELS: Record<string, string> = {
  software: '完整软件交付',
  prototype: '快速验证原型',
  refactor: '重构（行为不变）',
  debug: '排错修复',
  document: '文档产出',
  'improve-architecture': '架构改进',
  other: '轻量自动化',
};

export const PLAIN_PROVENANCE_LABELS: Record<string, string> = {
  human: '您亲自拍板',
  charter_direct: '按决策主旨自动作答',
  charter_inferred: '主旨推导后您已确认',
  escalated: '主旨未覆盖，您拍板定案',
};

export const PLAIN_DECISION_KIND_LABELS: Record<string, string> = {
  auto: '主旨已覆盖，默认采纳',
  conflict: '主旨冲突，需您拍板',
  uncovered: '主旨未覆盖，需您拍板',
  lowconf: '置信偏低，请确认',
};

export const PLAIN_TOOL_LABELS: Record<string, string> = {
  'code-runner': '运行命令验证',
  'llm-text': 'AI 生成内容',
  'file-write': '写入文件',
  'file-read': '读取文件',
};

/** 正文内嵌术语替换（最长优先，避免子串误伤）。 */
const JARGON_REPLACEMENTS: Array<{ pattern: RegExp; plain: string }> = [
  { pattern: /\bstage_zoom_out\b/gi, plain: '工作区全景扫描' },
  { pattern: /\bDecisionRecord\b/g, plain: '决策清单' },
  { pattern: /\bcharter_direct\b/g, plain: '主旨直接作答' },
  { pattern: /\bcharter_inferred\b/g, plain: '主旨推导' },
  { pattern: /\bRED\s*→\s*GREEN\b/gi, plain: '先写失败测试再实现' },
  { pattern: /\bTDD\b/g, plain: '测试驱动' },
  { pattern: /\bgrill\b/gi, plain: '逐条追问' },
  { pattern: /\bslice\b/gi, plain: '功能切片' },
  { pattern: /\bHITL\b/g, plain: '人工把关' },
  { pattern: /\bsmoke\b/gi, plain: '冒烟自检' },
  { pattern: /\be2e\b/gi, plain: '端到端' },
];

export function humanizeJargon(text: string): string {
  let out = text;
  for (const { pattern, plain } of JARGON_REPLACEMENTS) {
    out = out.replace(pattern, plain);
  }
  return out;
}
