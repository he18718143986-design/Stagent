/**
 * M35 / #1：工作流生成链（从 `WorkflowEngine` 抽出 normalize / JSON 解析 / 生成前上下文组装）。
 * 引擎仍负责 Webview 消息、实例生命周期与 LLM 委托；本模块聚焦可单测的生成逻辑。
 */
import * as crypto from 'crypto';
import type { FileReadConfig, WorkflowDefinition } from './WorkflowDefinition';
import { ensureDecisionPromptStrict, safeSnippet } from './WorkflowPrompts';
import {
  ensureSoftwareWorkflowHasDecisionStage,
  normalizeDecisionStage,
} from './workflow/DecisionStageShape';
import { normalizeQuestions } from './QuestionNormalization';
import { hoistStageWriteOutputToToolConfig } from './WorkflowEngineHelpers';
import { normalizeCodeRunnerTimeoutsForWorkflow } from './CodeRunnerInvokeHelpers';
import { isImplStageId, STAGE_ID_ZOOM_OUT } from './workflow/StageIdPatterns';
import { isFileReadTool } from './workflow/StageToolKinds';
import {
  TRACE_STAGE_WORKFLOW_GEN_CONTINUE,
  TRACE_STAGE_WORKFLOW_GEN_REPAIR,
} from './generation/GenerationTraceStageIds';
import { splitBundledTestRunCommands, splitBundledVenvPipImportCommands } from './TestRunCommandNormalize';
import { applyPythonWorkflowRepairs } from './structural-repair/pythonWorkflowRepair';
import { injectImplSliceScopePrompts } from './impl-scope/injectImplSliceScope';
import { applyRule20StructuralNormalizations } from './WorkflowRule20Normalize';
import { generationMsg } from './l10n/gateMsg';
import { extractJsonObject, isLikelyTruncatedJson } from './JsonExtract';
import { buildJsonContinuationPrompt } from './LlmInvokeHelpers';
import type { LlmInvokeOpts } from './core/LlmInvokeOpts';
import {
  workflowGenContinueLlmInvokeOpts,
  workflowGenRepairLlmInvokeOpts,
} from './core/LlmInvokeOpts';
import { getStagentConfiguration } from './settings/getStagentConfiguration';
import { readLlmMaxOutputTokens } from './settings/readers/llm';
import {
  applySnapshotDegradation,
  buildCodebaseSnapshot,
  estimateTextTokens,
  formatSnapshotForPrompt,
} from './CodebaseContextProvider';
import {
  buildDependencyGraph,
  formatDependencyGraphForPrompt,
  resolveSrcDirForWorkspace,
} from './DependencyGraphAnalyzer';
import {
  estimateWorkflowComplexity,
  formatComplexityBlockForPrompt,
} from './WorkflowComplexityEstimator';
import {
  allocateContextBudget,
  DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT,
} from './InputContextPolicy';
import type { CodebaseSnapshot, CodebaseSnapshotLevel } from './CodebaseContextProvider';
import type { DependencyGraph } from './DependencyGraphAnalyzer';
import type { ComplexityEstimate } from './WorkflowComplexityEstimator';

export interface NormalizeWorkflowOptions {
  /** Rule 20-G：为 `stage_zoom_out` 选择可读 filePath（由引擎注入项目根扫描）。 */
  pickZoomOutFilePath?: (preferred?: string) => string;
  /** `stagent.autoInsertGlobalArchitectureDecision`；默认 false */
  autoInsertGlobalArchitectureDecision?: boolean;
  /** M38.2：`stagent.execution.splitTestRunBundledCommands`；默认 true */
  splitTestRunBundledCommands?: boolean;
  /** M25-F2：将 stage_zoom_out 升级为 llm-text（非 greenfield 或已有 CONTEXT 时） */
  upgradeZoomOut?: boolean;
  zoomOutGlossaryHint?: string;
}

/** 生成后 / startExecution 入场前的结构归一化（M14.2 / M7 / M20 兜底）。 */
export function normalizeWorkflow(
  wf: WorkflowDefinition,
  userInput: string,
  taskType: string,
  options: NormalizeWorkflowOptions = {},
): WorkflowDefinition {
  const createdAt = wf.meta?.createdAt ?? new Date().toISOString();
  const normalized: WorkflowDefinition = {
    ...wf,
    version: '2.0',
    id: wf.id || `wf_${crypto.randomUUID()}`,
    meta: {
      title: wf.meta?.title ?? '生成的工作流',
      taskType: wf.meta?.taskType ?? taskType,
      userInput: wf.meta?.userInput ?? userInput,
      createdAt,
      isGreenfield: wf.meta?.isGreenfield,
      taskWorkspacePath: wf.meta?.taskWorkspacePath,
      engineAutoInsertedGlobalArchitectureStageId: wf.meta?.engineAutoInsertedGlobalArchitectureStageId,
    },
  };

  if (!Array.isArray(normalized.stages)) {
    normalized.stages = [];
  }
  for (const stage of normalized.stages) {
    if (!Array.isArray(stage.outputs)) {
      stage.outputs = [];
    }
  }

  ensureSoftwareWorkflowHasDecisionStage(normalized, {
    strictPrompt: ensureDecisionPromptStrict,
  });

  for (const stage of normalized.stages) {
    normalizeDecisionStage(stage, { strictPrompt: ensureDecisionPromptStrict });
  }

  for (const stage of normalized.stages) {
    if (stage.id !== STAGE_ID_ZOOM_OUT || !isFileReadTool(stage.tool)) {
      continue;
    }
    const cfg = stage.toolConfig as Partial<FileReadConfig>;
    if (options.pickZoomOutFilePath) {
      (stage.toolConfig as FileReadConfig).filePath = options.pickZoomOutFilePath(cfg.filePath);
    }
  }

  hoistStageWriteOutputToToolConfig(normalized);

  for (const stage of normalized.stages) {
    stage.questionBefore = normalizeQuestions(stage.questionBefore, stage.id, 'before');
    stage.questionAfter = normalizeQuestions(stage.questionAfter, stage.id, 'after');

    if (
      isImplStageId(stage.id) &&
      stage.pauseAfter === false &&
      (stage.questionAfter?.length ?? 0) > 0
    ) {
      const mergedBefore = [...(stage.questionBefore ?? []), ...stage.questionAfter!];
      stage.questionBefore = normalizeQuestions(mergedBefore, stage.id, 'before');
      stage.questionAfter = undefined;
    }
  }

  applyRule20StructuralNormalizations(normalized, {
    autoInsertGlobalArchitectureDecision: options.autoInsertGlobalArchitectureDecision === true,
    upgradeZoomOut: options.upgradeZoomOut === true,
    zoomOutGlossaryHint: options.zoomOutGlossaryHint,
  });

  if (options.splitTestRunBundledCommands !== false) {
    splitBundledTestRunCommands(normalized);
  }

  splitBundledVenvPipImportCommands(normalized);
  applyPythonWorkflowRepairs(normalized);

  normalizeCodeRunnerTimeoutsForWorkflow(normalized);

  injectImplSliceScopePrompts(normalized);

  return normalized;
}

export interface WorkflowJsonParseDeps {
  invokeLlmRaw: (
    systemPrompt: string,
    userContent: string,
    traceStageId: string,
    opts?: LlmInvokeOpts,
  ) => Promise<string>;
  /** 续接/修复阶段的额外 LLM 输出回调，供上层把这些 token 计入生成预算（含续接/修复，不再只算主输出）。 */
  onAuxLlmOutput?: (text: string) => void;
  /** 截断续接最大次数（默认 2）；达到上限仍未闭合则转入 repair。 */
  maxContinuations?: number;
  /** continue/repair 的 max_tokens（与 workflow-gen 主调用对齐）。 */
  maxOutputTokens?: number;
}

/** 默认截断续接上限：避免续接结果仍不完整时无限循环、token 失控。 */
export const DEFAULT_MAX_JSON_CONTINUATIONS = 2;

function resolveParseMaxOutputTokens(deps: WorkflowJsonParseDeps): number {
  return deps.maxOutputTokens ?? readLlmMaxOutputTokens(getStagentConfiguration());
}

async function repairWorkflowJson(raw: string, deps: WorkflowJsonParseDeps): Promise<string> {
  const repairPrompt = `你将收到一段本应为 WorkflowDefinition(JSON) 的文本，但可能夹杂解释文字或格式错误。
任务：只输出一个可被 JSON.parse 解析的 JSON 对象，不要 markdown，不要解释。
要求：
1) 保留原字段语义，补齐必要字段；
2) version 必须是 "2.0"；
3) stages 必须是数组；
4) 如果无法修复，请至少输出 {"id":"wf_invalid","version":"2.0","meta":{"title":"invalid","taskType":"software","userInput":"","createdAt":"${new Date().toISOString()}"},"stages":[]}。`;
  return deps.invokeLlmRaw(
    repairPrompt,
    raw,
    TRACE_STAGE_WORKFLOW_GEN_REPAIR,
    workflowGenRepairLlmInvokeOpts(resolveParseMaxOutputTokens(deps)),
  );
}

/** 从模型原始输出解析 WorkflowDefinition（提取 / 续写 / 修复）。 */
export async function parseWorkflowJson(raw: string, deps: WorkflowJsonParseDeps): Promise<WorkflowDefinition> {
  let jsonStr = extractJsonObject(raw);
  // 截断续接：改为有界循环（默认 2 次），每次累加输出，直到能提取出 JSON 或不再像截断。
  // 续接/修复的 LLM 输出经 onAuxLlmOutput 上报，供上层把它们计入 token 预算。
  const maxContinuations = deps.maxContinuations ?? DEFAULT_MAX_JSON_CONTINUATIONS;
  let accumulated = raw;
  let continuations = 0;
  while (!jsonStr && continuations < maxContinuations && isLikelyTruncatedJson(accumulated)) {
    const continuation = await deps.invokeLlmRaw(
      buildJsonContinuationPrompt(accumulated),
      '',
      TRACE_STAGE_WORKFLOW_GEN_CONTINUE,
      workflowGenContinueLlmInvokeOpts(resolveParseMaxOutputTokens(deps)),
    );
    deps.onAuxLlmOutput?.(continuation);
    accumulated += continuation;
    jsonStr = extractJsonObject(accumulated);
    continuations++;
  }
  if (!jsonStr) {
    const repaired = await repairWorkflowJson(accumulated, deps);
    deps.onAuxLlmOutput?.(repaired);
    jsonStr = extractJsonObject(repaired);
  }
  if (!jsonStr) {
    throw new Error(generationMsg('jsonParseFailed', safeSnippet(raw)));
  }
  try {
    return JSON.parse(jsonStr) as WorkflowDefinition;
  } catch {
    const repaired = await repairWorkflowJson(jsonStr, deps);
    deps.onAuxLlmOutput?.(repaired);
    const repairedStr = extractJsonObject(repaired);
    if (!repairedStr) {
      throw new Error(generationMsg('jsonExtractFailed', safeSnippet(jsonStr)));
    }
    return JSON.parse(repairedStr) as WorkflowDefinition;
  }
}

export interface SnapshotDegradedInfo {
  level: CodebaseSnapshotLevel;
  tokenBudget: number;
  tokens: number;
}

export interface GeneratorCodebaseContextParams {
  taskWorkspaceAbs: string;
  userInput: string;
  codebaseSnapshotEnabled: boolean;
  codebaseContextMaxTokens: number;
  /** 可选：引擎已构建快照时传入，避免重复扫描。 */
  codebaseSnapshot?: CodebaseSnapshot;
  onSnapshotDegraded?: (info: SnapshotDegradedInfo) => void;
  onDegraded?: (reason: string, context?: Record<string, unknown>) => void;
}

export interface GeneratorCodebaseContextResult {
  codebaseContext: string;
  codebaseSnapshot?: CodebaseSnapshot;
  complexity: ComplexityEstimate;
  depGraph: DependencyGraph;
}

/** 组装注入 `buildWorkflowGeneratorPrompt` 的 codebaseContext 块（快照 + 复杂度 + 依赖图）。 */
export function buildGeneratorCodebaseContextBlock(
  params: GeneratorCodebaseContextParams,
): GeneratorCodebaseContextResult {
  const { taskWorkspaceAbs, userInput, codebaseSnapshotEnabled, codebaseContextMaxTokens, onSnapshotDegraded } =
    params;
  const codebaseSnapshot =
    params.codebaseSnapshot ??
    (codebaseSnapshotEnabled
      ? buildCodebaseSnapshot(taskWorkspaceAbs, { onDegraded: params.onDegraded })
      : undefined);
  let codebaseContext = '';
  if (codebaseSnapshot) {
    const fullPreview = formatSnapshotForPrompt(codebaseSnapshot, 'full');
    const tokenEst = estimateTextTokens(fullPreview);
    const { allocations } = allocateContextBudget([], DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT, {
      includeCodebaseSnapshot: true,
      codebaseSnapshotTokens: tokenEst,
    });
    const granted =
      allocations.find((a) => a.category === 'codebase-snapshot')?.grantedTokens ?? codebaseContextMaxTokens;
    const budgetTokens = Math.min(codebaseContextMaxTokens, granted);
    const degraded = applySnapshotDegradation(codebaseSnapshot, budgetTokens);
    codebaseContext = degraded.text;
    onSnapshotDegraded?.({
      level: degraded.level,
      tokenBudget: budgetTokens,
      tokens: estimateTextTokens(degraded.text),
    });
  }

  const complexity = estimateWorkflowComplexity(userInput, codebaseSnapshot);
  const complexityBlock = formatComplexityBlockForPrompt(complexity);
  codebaseContext = codebaseContext ? `${codebaseContext}\n\n${complexityBlock}` : complexityBlock;

  const depGraph = buildDependencyGraph(resolveSrcDirForWorkspace(taskWorkspaceAbs));
  const depGraphPrompt = formatDependencyGraphForPrompt(depGraph);
  if (depGraphPrompt) {
    codebaseContext = `${codebaseContext}\n\n${depGraphPrompt}`;
  }
  return { codebaseContext, codebaseSnapshot, complexity, depGraph };
}
