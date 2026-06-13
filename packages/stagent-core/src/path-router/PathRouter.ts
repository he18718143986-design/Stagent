import { isRequirementClearEnough } from '../pregen/RequirementClarity';
import { userHintsMultiModuleOrFullProject } from '../workflow/MultiModuleUserInputHints';
import { detectMultiModuleLayout } from './multiModuleLayoutDetect';
import type { WorkspaceSignals } from './WorkspaceSignals';
import { resolveStackProfile, stackProfileLabel, type StackProfile } from './StackProfile';
import { workflowTemplateConstraintBlock } from './PathRouterPrompts';
import {
  EXPRESS_TEMPLATE_STAGE_SOFT_CAP,
  plainWorkflowTemplateLabel,
  type WorkflowTemplate,
} from './WorkflowTemplateTypes';

const DEBUG_INTENT_RE =
  /\b(?:bug|fix|debug|regression|repro)\b|修复|排错|报错|异常|崩溃|根因|复现|失败用例|flaky/i;
const ARCH_INTENT_RE =
  /架构治理|架构改进|improve[\s-]?arch|ball[\s-]?of[\s-]?mud|模块地图|deletion[\s-]?test|seam\s+分析/i;
const EXPRESS_INTENT_RE =
  /express|快速通道|单切片|single[\s-]?slice|不要多切片|不要架构|最小环|仅.*单文件|单文件|空目录|不要.*多模块|单切片\s*TDD/i;
const FULL_PROJECT_INTENT_RE =
  /to-prd|写\s*prd|拆\s*issue|多切片|垂直切片\s*\d|完整交付|全量流程|grill-with-docs/i;

export interface PathRouterInput {
  userInput: string;
  signals: WorkspaceSignals;
  uiTaskType?: string;
}

export interface PathRouterResult {
  workflowTemplate: WorkflowTemplate;
  suggestedIsGreenfield: boolean;
  stackProfile: StackProfile;
  rationaleLines: string[];
}

function userHintsDebug(userInput: string): boolean {
  return DEBUG_INTENT_RE.test(userInput);
}

function userHintsArchReview(userInput: string): boolean {
  return ARCH_INTENT_RE.test(userInput);
}

function userHintsExpress(userInput: string): boolean {
  return EXPRESS_INTENT_RE.test(userInput);
}

function userHintsFullProject(userInput: string): boolean {
  if (/不要.*多切片|单切片|single[\s-]?slice|不要.*多模块/i.test(userInput)) {
    return false;
  }
  return userHintsMultiModuleOrFullProject(userInput) || FULL_PROJECT_INTENT_RE.test(userInput);
}

/** 单切片、行为是否足够清晰以走 Express（WORKFLOW §16.0 P3）。 */
export function isExpressEligible(
  userInput: string,
  signals: WorkspaceSignals,
  taskType?: string,
): boolean {
  if (detectMultiModuleLayout({ taskType, userInput })) {
    return false;
  }
  if (userHintsFullProject(userInput)) {
    return false;
  }
  if (userHintsExpress(userInput)) {
    return true;
  }
  if (!isRequirementClearEnough(userInput)) {
    return false;
  }
  if (userHintsMultiModuleOrFullProject(userInput)) {
    return false;
  }
  // 棕场但改动面小：模块少、需求清楚
  if (signals.hasSubstantialCode && signals.moduleCount <= 1 && userInput.length >= 40) {
    return true;
  }
  // 绿场空目录 + 清楚的小需求（冒烟 greet / calculator 单切片）
  if (!signals.hasSubstantialCode && signals.sourceFileCount <= 2 && userInput.length >= 30) {
    return true;
  }
  return false;
}

function resolveTemplateByRules(input: PathRouterInput): PathRouterResult {
  const { userInput, signals, uiTaskType } = input;
  const lines: string[] = [];
  const ui = uiTaskType?.trim().toLowerCase();

  if (ui === 'debug') {
    lines.push('任务类型为排错修复，路由到 debug 模板。');
    return {
      workflowTemplate: 'debug',
      suggestedIsGreenfield: !signals.hasSubstantialCode,
      stackProfile: 'auto',
      rationaleLines: lines,
    };
  }
  if (ui === 'improve-architecture') {
    lines.push('任务类型为架构改进，路由到 arch_review 模板。');
    return {
      workflowTemplate: 'arch_review',
      suggestedIsGreenfield: false,
      stackProfile: 'auto',
      rationaleLines: lines,
    };
  }

  if (userHintsDebug(userInput) && !userHintsFullProject(userInput)) {
    lines.push('需求表述以修 bug / 复现 / 回归为主，路由到 debug 模板。');
    return {
      workflowTemplate: 'debug',
      suggestedIsGreenfield: !signals.hasSubstantialCode,
      stackProfile: 'auto',
      rationaleLines: lines,
    };
  }
  if (userHintsArchReview(userInput)) {
    lines.push('需求表述为架构治理 / seam 分析，路由到 arch_review 模板。');
    return {
      workflowTemplate: 'arch_review',
      suggestedIsGreenfield: false,
      stackProfile: 'auto',
      rationaleLines: lines,
    };
  }

  if (isExpressEligible(userInput, signals, ui)) {
    if (userHintsExpress(userInput)) {
      lines.push('需求明示走快速通道（Express）或单切片 TDD。');
    } else if (!signals.hasSubstantialCode) {
      lines.push('工作区无 substantial 代码，且需求范围小、验收清楚，走 Express 而非绿场全量。');
    } else {
      lines.push('已有代码但单切片、行为清晰，走 Brownfield Express。');
    }
    if (signals.hasContextMd) {
      lines.push('已检测到 CONTEXT.md，Express 链将沿用现有术语。');
    }
    return {
      workflowTemplate: 'express',
      suggestedIsGreenfield: !signals.hasSubstantialCode,
      stackProfile: 'auto',
      rationaleLines: lines,
    };
  }

  if (!signals.hasSubstantialCode) {
    lines.push('工作区无 substantial 代码（绿场），路由到 greenfield_full。');
    if (!signals.hasContextMd) {
      lines.push('未检测到 CONTEXT.md：全量链将包含术语/决策对齐。');
    }
    return {
      workflowTemplate: 'greenfield_full',
      suggestedIsGreenfield: true,
      stackProfile: 'auto',
      rationaleLines: lines,
    };
  }

  lines.push('工作区已有 substantial 代码，且需求非单切片 Express，路由到 brownfield_full。');
  if (!signals.hasContextMd) {
    lines.push('未检测到 CONTEXT.md：计划将含工作区全景扫描（zoom-out）门禁。');
  }
  if (signals.moduleCount >= 3) {
    lines.push(`扫描到约 ${signals.moduleCount} 个模块，倾向多切片 TDD。`);
  }
  return {
    workflowTemplate: 'brownfield_full',
    suggestedIsGreenfield: false,
    stackProfile: 'auto',
    rationaleLines: lines,
  };
}

/** WORKFLOW §4.1 / §16.0：需求 × 仓库信号 → workflowTemplate。 */
export function routeWorkflowTemplate(input: PathRouterInput): PathRouterResult {
  const result = resolveTemplateByRules(input);
  const stackProfile = resolveStackProfile(
    input.userInput,
    input.uiTaskType ?? '',
    result.workflowTemplate,
  );
  result.stackProfile = stackProfile;
  result.rationaleLines.unshift(
    `Path Router 建议路径：${plainWorkflowTemplateLabel(result.workflowTemplate)}（${result.workflowTemplate}），栈：${stackProfileLabel(stackProfile)}。`,
  );
  if (!input.signals.hasDocsAgents) {
    result.rationaleLines.push('未检测到 docs/agents/：若为首用仓库，执行前请核对 setup。');
  }
  return result;
}

/** 注入工作流生成器 system prompt 的 Path Router 块。 */
export function formatPathRouterBlockForPrompt(result: PathRouterResult): string {
  const gf = result.suggestedIsGreenfield ? 'true' : 'false';
  const rationale = result.rationaleLines.map((l) => `- ${l}`).join('\n');
  const stackLine =
    result.stackProfile === 'python'
      ? '- 建议 globalConfig: { "language": "python", "stackProfile": "python" }'
      : result.stackProfile === 'node'
        ? '- 建议 globalConfig.stackProfile: "node"（npm/jest 栈）'
        : '';
  return [
    '【Path Router — 生成前已判定，须写入 meta.workflowTemplate】',
    `- workflowTemplate: ${result.workflowTemplate}`,
    `- stackProfile: ${result.stackProfile}`,
    `- 建议 meta.isGreenfield: ${gf}`,
    stackLine,
    '判别依据：',
    rationale,
    '',
    workflowTemplateConstraintBlock(result.workflowTemplate, result.stackProfile),
    '',
    '生成时 **必须** 在 meta 中写入 workflowTemplate（与上表一致）；stages 仅遵守该模板约束块 + 匹配 taskType 的类型约束块。',
  ].join('\n');
}

/** Express 模板阶段数软校验（生成后警告）。 */
export function expressTemplateStageWarnings(
  template: WorkflowTemplate | undefined,
  stageCount: number,
): string[] {
  if (template !== 'express') {
    return [];
  }
  if (stageCount <= EXPRESS_TEMPLATE_STAGE_SOFT_CAP) {
    return [];
  }
  return [
    `path-router:express-stage-cap:${stageCount}>${EXPRESS_TEMPLATE_STAGE_SOFT_CAP}`,
  ];
}
