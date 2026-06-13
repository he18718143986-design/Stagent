/** WORKFLOW.md §4.2 平台 workflowTemplate 枚举（P0 Path Router）。 */
export const WORKFLOW_TEMPLATES = [
  'express',
  'greenfield_full',
  'brownfield_full',
  'debug',
  'arch_review',
] as const;

export type WorkflowTemplate = (typeof WORKFLOW_TEMPLATES)[number];

const TEMPLATE_SET = new Set<string>(WORKFLOW_TEMPLATES);

export function isWorkflowTemplate(value: string | undefined): value is WorkflowTemplate {
  return !!value && TEMPLATE_SET.has(value);
}

/** 确认页白话标签（与 TranslationGlossary 对齐）。 */
export const PLAIN_WORKFLOW_TEMPLATE_LABELS: Record<WorkflowTemplate, string> = {
  express: '快速通道（Express）',
  greenfield_full: '绿场全量',
  brownfield_full: '棕场全量',
  debug: '排错修复',
  arch_review: '架构治理',
};

export function plainWorkflowTemplateLabel(template: WorkflowTemplate | undefined): string {
  if (!template) {
    return '未指定';
  }
  return PLAIN_WORKFLOW_TEMPLATE_LABELS[template] ?? template;
}

/** Express 路径阶段上限（WORKFLOW P3：3–8 个 skill）。 */
export const EXPRESS_TEMPLATE_STAGE_SOFT_CAP = 8;
