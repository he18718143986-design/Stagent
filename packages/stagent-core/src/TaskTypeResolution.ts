import { humanizeJargon } from './friendly/TranslationGlossary';
import { plainTaskTypeLabel } from './friendly/toPlainLanguage';
import {
  plainWorkflowTemplateLabel,
  type WorkflowTemplate,
} from './path-router/WorkflowTemplateTypes';

/** UI / 消息协议：由模型在 generateWorkflow 同次调用中决定 meta.taskType */
export const AUTO_TASK_TYPE = 'auto';

export const KNOWN_TASK_TYPES = [
  'software',
  'refactor',
  'debug',
  'prototype',
  'document',
  'improve-architecture',
  'other',
] as const;

export type KnownTaskType = (typeof KNOWN_TASK_TYPES)[number];

const KNOWN_SET = new Set<string>(KNOWN_TASK_TYPES);

export function isAutoTaskType(taskType: string | undefined): boolean {
  const t = taskType?.trim().toLowerCase();
  return !t || t === AUTO_TASK_TYPE;
}

export function isKnownTaskType(taskType: string | undefined): taskType is KnownTaskType {
  return !!taskType && KNOWN_SET.has(taskType.trim().toLowerCase());
}

/** 非 auto 时返回 trim 后的显式类型；auto/空 返回 undefined */
function normalizeTaskTypeOverride(taskType: string | undefined): KnownTaskType | undefined {
  if (isAutoTaskType(taskType)) {
    return undefined;
  }
  const t = taskType!.trim().toLowerCase();
  if (KNOWN_SET.has(t)) {
    return t as KnownTaskType;
  }
  return 'other';
}

/**
 * 生成后有效 taskType：显式 UI 覆盖优先；否则采用模型 meta.taskType；再否则 other（避免误走 software 磁盘管线）。
 */
export function resolveGeneratedTaskType(
  metaTaskType: string | undefined,
  uiTaskType: string | undefined,
): KnownTaskType {
  const override = normalizeTaskTypeOverride(uiTaskType);
  if (override) {
    return override;
  }
  const fromMeta = metaTaskType?.trim().toLowerCase();
  if (fromMeta && KNOWN_SET.has(fromMeta)) {
    return fromMeta as KnownTaskType;
  }
  return 'other';
}

/** B-R1：确认页展示的场景判别摘要（G1 可解释性）。 */
export interface TaskTypeClassificationInfo {
  uiTaskType: string;
  modelTaskType?: string;
  effectiveTaskType: KnownTaskType;
  effectiveTaskTypePlain?: string;
  isGreenfield?: boolean;
  hasZoomOutStage: boolean;
  workflowTemplate?: WorkflowTemplate;
  workflowTemplatePlain?: string;
  suggestedWorkflowTemplate?: WorkflowTemplate;
  suggestedWorkflowTemplatePlain?: string;
  rationaleLines: string[];
}

const ZOOM_OUT_STAGE_ID = 'stage_zoom_out';

export function workflowHasZoomOutStage(stages: { id: string }[] | undefined): boolean {
  return (stages ?? []).some((s) => s.id === ZOOM_OUT_STAGE_ID);
}

/** 生成确认页可读的 taskType / isGreenfield 判别依据。 */
export function buildTaskTypeClassificationInfo(params: {
  uiTaskType: string;
  modelTaskType?: string;
  effectiveType: KnownTaskType;
  isGreenfield?: boolean;
  hasZoomOutStage?: boolean;
  workflowTemplate?: WorkflowTemplate;
  suggestedWorkflowTemplate?: WorkflowTemplate;
  pathRouterRationaleLines?: string[];
}): TaskTypeClassificationInfo {
  const lines: string[] = [];
  const ui = params.uiTaskType?.trim() || AUTO_TASK_TYPE;
  const model = params.modelTaskType?.trim().toLowerCase();

  const plainEffective = plainTaskTypeLabel(params.effectiveType);
  const plainModel = model ? plainTaskTypeLabel(model) : undefined;

  if (!isAutoTaskType(ui)) {
    lines.push(`您在输入页选了「${plainTaskTypeLabel(ui)}」，已覆盖模型建议。`);
  } else if (model && isKnownTaskType(model)) {
    lines.push(`模型根据需求与工作区扫描，判别为「${plainModel}」。`);
  } else if (model) {
    lines.push(`模型返回了非标准类型「${model}」，已回退为「${plainEffective}」。`);
  } else {
    lines.push(`模型未返回任务类型，已回退为「${plainEffective}」。`);
  }

  if (params.isGreenfield === true) {
    lines.push('判别为全新项目：可跳过「工作区全景扫描」门禁。');
  } else if (params.isGreenfield === false) {
    lines.push('判别为在已有代码上改动：工作区里已有实质代码。');
  }

  if (params.hasZoomOutStage) {
    lines.push('计划含工作区全景扫描：实现前会先产出模块地图。');
  }

  const template = params.workflowTemplate;
  if (params.pathRouterRationaleLines?.length) {
    for (const line of params.pathRouterRationaleLines) {
      lines.push(line);
    }
  } else if (template) {
    lines.push(`工作流路径：${plainWorkflowTemplateLabel(template)}。`);
  }

  return {
    uiTaskType: ui,
    modelTaskType: model || undefined,
    effectiveTaskType: params.effectiveType,
    effectiveTaskTypePlain: plainEffective,
    isGreenfield: params.isGreenfield,
    hasZoomOutStage: !!params.hasZoomOutStage,
    workflowTemplate: template,
    workflowTemplatePlain: template ? plainWorkflowTemplateLabel(template) : undefined,
    suggestedWorkflowTemplate: params.suggestedWorkflowTemplate,
    suggestedWorkflowTemplatePlain: params.suggestedWorkflowTemplate
      ? plainWorkflowTemplateLabel(params.suggestedWorkflowTemplate)
      : undefined,
    rationaleLines: lines.map((l) => humanizeJargon(l)),
  };
}

export function buildTaskTypeOverrideWarning(
  uiTaskType: string | undefined,
  modelTaskType: string | undefined,
  effectiveType: KnownTaskType,
): string | undefined {
  const override = normalizeTaskTypeOverride(uiTaskType);
  if (!override) {
    return undefined;
  }
  const model = modelTaskType?.trim().toLowerCase();
  if (!model || model === override) {
    return undefined;
  }
  return `taskType:ui-override:${override}:model-suggested:${model}:effective:${effectiveType}`;
}
