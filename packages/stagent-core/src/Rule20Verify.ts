import type { WorkflowDefinition } from './WorkflowDefinition';
import { findStageIdsUnreachableFromFirstStage, formatWorkflowDependencyCycleError } from './WorkflowDag';
import { collectWorkflowArtifacts } from './WorkflowArtifactRegistry';
import { detectPythonImportLintIssues } from './CodeRunnerImportLint';
import { isHorizontalTddPlan } from './RedGreenGate';
import { isSkillNativeWorkflow } from './SkillToolKinds';
import { isGlobalArchitectureDecideStageId } from './workflow/StageIdPatterns';
import { isStagentBundleWriteStage } from './disk-bootstrap/constants';
import { STAGE_IMPL_CONFTEST_ID } from './disk-bootstrap/pythonConftestStage';

function isSoftwareSliceImplStage(stage: { id: string }): boolean {
  if (!/^stage_impl_/.test(stage.id)) {
    return false;
  }
  if (isStagentBundleWriteStage(stage) || stage.id === STAGE_IMPL_CONFTEST_ID) {
    return false;
  }
  return true;
}

export type ViolationType =
  | 'missing-decision-stage'
  | 'broken-naming-pair'
  | 'missing-decisionRecord-source'
  | 'missing-constraint-prompt'
  | 'test-run-must-use-code-runner'
  | 'test-run-imports-missing-artifact';
export type WarningType =
  | 'exposeAssumptions-exemption'
  | 'model-tier-downgrade'
  | 'prototype-missing-verification-stage'
  | 'prototype-missing-success-criteria'
  | 'prototype-impl-missing-file-read-followup'
  | 'debug-missing-reproduce-stage'
  | 'debug-missing-hypothesis-stage'
  | 'debug-missing-verification-stage'
  | 'debug-impl-missing-decision-source'
  | 'to-issues-missing-chain'
  | 'to-issues-missing-verification'
  | 'to-issues-monolithic-impl-naming'
  | 'to-issues-high-hitl-ratio'
  | 'to-issues-horizontal-layering'
  | 'refactor-missing-decision-stage'
  | 'refactor-missing-verification-stage'
  | 'refactor-monolithic-impl-naming'
  | 'software-missing-global-architecture-decision'
  | 'horizontal-tdd'
  | 'debug-feedback-loop-not-first'
  | 'dag-unreachable-from-entry'
  | 'dag-dependency-cycle-hint'
  | 'global-architecture-decision-auto-inserted';

export interface VerifyIssue {
  type: ViolationType | WarningType;
  stageId: string;
  message: string;
}

export interface VerifyResult {
  passed: boolean;
  violations: VerifyIssue[];
  warnings: VerifyIssue[];
}

function userHintsMultiModuleOrFullProject(userInput: string): boolean {
  return /完整项目|多模块|全栈|全栈项目|端到端|管理系统.*小程序|小程序.*管理后台|multiple\s+modules|full[\s-]?stack|full\s+project/i.test(
    userInput,
  );
}

function hasGlobalArchitectureDecisionStage(workflow: WorkflowDefinition): boolean {
  return workflow.stages.some(
    (s) =>
      s.isDecisionStage === true &&
      /^stage_decide_(architecture_overview|architecture|global_|project_architecture|full_stack|system_design)/i.test(
        s.id,
      ),
  );
}

const PROTOTYPE_CORE_IMPL_PATTERN =
  /stage_impl_(?:prototype_)?(?:reader|fetcher|analyzer|writer|main)\b/i;

/** 集成入口脚本：运行它会在运行期 import 整组模块（磁盘即真源）。 */
const PROTOTYPE_ENTRY_SCRIPT_PATTERN =
  /\b(?:main|app|monitor|run|cli|server|index|manage|start|__main__)\.(?:py|js|ts|mjs|cjs)\b/i;

/**
 * 下游 code-runner 集成测试是否在运行期消费该产物：
 * 命令直接引用该产物（文件名 / 去扩展名的模块名），或运行某入口脚本（入口会 import 整组模块）。
 * 注意：仅当命令真正触达产物/入口时才算消费，避免把「import 未落盘模块」的坏命令误判为已消费。
 */
function isArtifactConsumedByDownstreamRunner(
  stages: WorkflowDefinition['stages'],
  implIdx: number,
  artifactPath: string,
): boolean {
  const base = artifactPath.split(/[\\/]/).pop() ?? artifactPath;
  const moduleName = base.replace(/\.[^.]+$/, '');
  const moduleRe = moduleName ? new RegExp(`\\b${moduleName.replace(/[^\w]/g, '\\$&')}\\b`) : null;
  for (let j = implIdx + 1; j < stages.length; j++) {
    const s = stages[j];
    if (s.tool !== 'code-runner') {
      continue;
    }
    const cmd = String((s.toolConfig as { command?: string }).command ?? '');
    if (cmd.includes(base) || (moduleRe && moduleRe.test(cmd)) || PROTOTYPE_ENTRY_SCRIPT_PATTERN.test(cmd)) {
      return true;
    }
  }
  return false;
}

/** M20.2：核心 prototype impl 落盘后应有 file-read 或下一 impl 的 stage-output 引用 */
function verifyPrototypeImplFileReadFollowup(workflow: WorkflowDefinition, warnings: VerifyIssue[]): void {
  const stages = workflow.stages;
  const implWithWrite = stages.filter((s) => {
    if (s.tool !== 'llm-text' || !/^stage_impl_/.test(s.id)) {
      return false;
    }
    const out = (s.toolConfig as { writeOutputToFile?: string }).writeOutputToFile;
    return !!out?.trim();
  });
  if (implWithWrite.length < 2) {
    return;
  }

  for (const impl of implWithWrite) {
    if (!PROTOTYPE_CORE_IMPL_PATTERN.test(impl.id)) {
      continue;
    }
    const artifactPath = String((impl.toolConfig as { writeOutputToFile?: string }).writeOutputToFile).trim();
    const implIdx = stages.findIndex((s) => s.id === impl.id);
    if (implIdx < 0) {
      continue;
    }

    let hasFollowup = false;
    for (let j = implIdx + 1; j < stages.length; j++) {
      const next = stages[j];
      if (/^stage_test_run_/.test(next.id) || next.tool === 'code-runner') {
        // 交给下方运行期消费判定（避免把「import 未落盘模块」的坏命令误判为已消费）。
        break;
      }
      if (next.tool === 'file-read') {
        const fp = String((next.toolConfig as { filePath?: string }).filePath ?? '').trim();
        if (fp === artifactPath) {
          hasFollowup = true;
          break;
        }
      }
      if (next.tool === 'llm-text' && /^stage_impl_/.test(next.id)) {
        const refsImpl = next.input.sources.some(
          (src) => src.type === 'stage-output' && src.stageId === impl.id,
        );
        const refsFile = next.input.sources.some(
          (src) =>
            src.type === 'file' &&
            String(src.filePath ?? '').trim() === artifactPath,
        );
        if (refsImpl || refsFile) {
          hasFollowup = true;
        }
        break;
      }
    }

    // 下游 code-runner 集成测试在运行期消费该产物（跑入口脚本 import 整组模块，或直接引用产物）。
    if (!hasFollowup && isArtifactConsumedByDownstreamRunner(stages, implIdx, artifactPath)) {
      hasFollowup = true;
    }

    if (!hasFollowup) {
      warnings.push({
        type: 'prototype-impl-missing-file-read-followup',
        stageId: impl.id,
        message:
          `prototype 实现 ${impl.id} 落盘「${artifactPath}」后，建议插入 file-read 阶段，` +
          `或令下一 impl 通过 stage-output/file 引用该产物（warning）。`,
      });
    }
  }
}

export function verifyRule20(workflow: WorkflowDefinition): VerifyResult {
  const violations: VerifyIssue[] = [];
  const warnings: VerifyIssue[] = [];
  // S3：skill-native（纯规划/对齐）工作流不受 impl 形状规则约束——Rule20 仅作后置 verifier，
  // 对其放行（见 SKILLS-ENGINE-INTEGRATION.md §7）。
  if (isSkillNativeWorkflow(workflow)) {
    return { passed: true, violations, warnings };
  }
  const isSoftware = workflow.meta?.taskType === 'software';

  const implStages = workflow.stages.filter(isSoftwareSliceImplStage);
  const decideStages = workflow.stages.filter((s) => s.isDecisionStage && /^stage_decide_/.test(s.id));

  if (workflow.globalConfig?.modelOverrides?.decisionStage) {
    warnings.push({
      type: 'model-tier-downgrade',
      stageId: 'globalConfig',
      message: '检测到 globalConfig.modelOverrides.decisionStage，需确认是否为有意识降级。',
    });
  }

  if (isSoftware) {
    for (const impl of implStages) {
      const semanticName = impl.id.replace(/^stage_impl_/, '');
      const pairedDecide = decideStages.find((d) => d.id === `stage_decide_${semanticName}`);
      if (!pairedDecide) {
        if (impl.exposeAssumptions) {
          warnings.push({
            type: 'exposeAssumptions-exemption',
            stageId: impl.id,
            message: '实现阶段无对应决策阶段，但声明 exposeAssumptions=true（豁免）',
          });
        } else {
          violations.push({
            type: 'missing-decision-stage',
            stageId: impl.id,
            message: '实现阶段缺少对应决策阶段',
          });
        }
      }
    }

    for (const dec of decideStages) {
      if (isGlobalArchitectureDecideStageId(dec.id)) {
        continue;
      }
      const semanticName = dec.id.replace(/^stage_decide_/, '');
      const hasPaired = workflow.stages.some(
        (s) => s.id === `stage_impl_${semanticName}` || s.id === `stage_${semanticName}`,
      );
      if (!hasPaired) {
        violations.push({
          type: 'broken-naming-pair',
          stageId: dec.id,
          message: '决策阶段找不到同 semanticName 的下游阶段（stage_impl_* 或 stage_*）',
        });
      }
    }

    for (const impl of implStages) {
      const hasDecisionSource = impl.input.sources.some(
        (src) =>
          src.type === 'stage-output' &&
          src.outputKey === 'decisionRecord' &&
          /^stage_decide_/.test(src.stageId || ''),
      );
      if (!hasDecisionSource) {
        violations.push({
          type: 'missing-decisionRecord-source',
          stageId: impl.id,
          message: '实现阶段 input.sources 缺少 decisionRecord 依赖',
        });
      }
    }

    for (const impl of implStages) {
      const prompt = String((impl.toolConfig as { systemPrompt?: unknown })?.systemPrompt ?? '');
      if (!prompt.includes('严格按照已确认的决策清单实现')) {
        violations.push({
          type: 'missing-constraint-prompt',
          stageId: impl.id,
          message: '实现阶段 systemPrompt 缺少“严格按照已确认的决策清单实现”约束语句',
        });
      }
    }

    const userText = workflow.meta?.userInput ?? '';
    if (
      (implStages.length > 5 || userHintsMultiModuleOrFullProject(userText)) &&
      !hasGlobalArchitectureDecisionStage(workflow)
    ) {
      warnings.push({
        type: 'software-missing-global-architecture-decision',
        stageId: 'workflow',
        message:
          'software 工作流疑似多模块/完整项目（stage_impl_* 数量 >5 或用户输入含全栈/多模块等关键词），建议在首个切片决策前插入全局架构决策阶段（如 stage_decide_architecture_overview），见 SPEC §7.8（warning）。',
      });
    }
  }

  // 任意 taskType：stage_test_run_* 必须为真实可执行验证（禁止 llm-text 冒充「跑测试」）
  for (const s of workflow.stages) {
    if (/^stage_test_run_/.test(s.id) && s.tool !== 'code-runner') {
      violations.push({
        type: 'test-run-must-use-code-runner',
        stageId: s.id,
        message:
          '阶段 id 为 stage_test_run_* 时必须使用 tool="code-runner"（例如 npm test / npm run test），禁止用 llm-text 口述测试结果',
      });
    }
  }

  // P1: to-issues 专项规则（warning-only，不阻断主流程）
  const hasToIssuesShape =
    isSoftware &&
    implStages.length > 0 &&
    workflow.stages.some((s) => /^stage_test_write_/.test(s.id) || /^stage_test_run_/.test(s.id));
  if (hasToIssuesShape) {
    const decideSet = new Set(workflow.stages.filter((s) => /^stage_decide_/.test(s.id)).map((s) => s.id));
    const writeSet = new Set(workflow.stages.filter((s) => /^stage_test_write_/.test(s.id)).map((s) => s.id));
    const runSet = new Set(workflow.stages.filter((s) => /^stage_test_run_/.test(s.id)).map((s) => s.id));

    const decideIndices = workflow.stages
      .map((s, i) => (/^stage_decide_/.test(s.id) ? i : -1))
      .filter((i) => i >= 0);
    const implIndices = workflow.stages
      .map((s, i) => (/^stage_impl_/.test(s.id) ? i : -1))
      .filter((i) => i >= 0);
    if (decideIndices.length >= 2 && implIndices.length >= 1) {
      const lastDecide = Math.max(...decideIndices);
      const firstImpl = Math.min(...implIndices);
      if (firstImpl > lastDecide) {
        warnings.push({
          type: 'to-issues-horizontal-layering',
          stageId: 'workflow',
          message:
            '检测到多个决策阶段全部排在首个实现阶段之前，疑似水平分层（批量决策后再进入实现）。建议按切片交错推进 decide→test_write→impl→test_run（warning）。',
        });
      }
    }

    for (const impl of implStages) {
      const semantic = impl.id.replace(/^stage_impl_/, '');
      const hasChain =
        decideSet.has(`stage_decide_${semantic}`) &&
        writeSet.has(`stage_test_write_${semantic}`) &&
        runSet.has(`stage_test_run_${semantic}`);
      if (!hasChain) {
        warnings.push({
          type: 'to-issues-missing-chain',
          stageId: impl.id,
          message: 'to-issues 垂直切片链路不完整，建议补齐 decide/test_write/impl/test_run（warning）。',
        });
      }

      const hasVerification =
        runSet.has(`stage_test_run_${semantic}`) ||
        workflow.stages.some((s) => s.tool === 'code-runner' && new RegExp(semantic, 'i').test(s.id));
      if (!hasVerification) {
        warnings.push({
          type: 'to-issues-missing-verification',
          stageId: impl.id,
          message: 'to-issues 切片缺少可执行验证阶段（test_run/code-runner）（warning）。',
        });
      }

      if (/(all|core|everything|global|system)$/i.test(impl.id)) {
        warnings.push({
          type: 'to-issues-monolithic-impl-naming',
          stageId: impl.id,
          message: 'to-issues 不建议使用聚合式 impl 命名，建议改为单切片语义命名（warning）。',
        });
      }
    }

    const pauseCount = workflow.stages.filter((s) => s.pauseAfter).length;
    const hitlRatio = workflow.stages.length > 0 ? pauseCount / workflow.stages.length : 0;
    if (hitlRatio > 0.4) {
      warnings.push({
        type: 'to-issues-high-hitl-ratio',
        stageId: 'workflow',
        message: `to-issues HITL 比例偏高（${hitlRatio.toFixed(2)}），建议优先 AFK 链路（warning）。`,
      });
    }
  }

  // P2: debug 专项规则（warning-only，不阻断主流程）
  if (workflow.meta?.taskType === 'debug') {
    const hasReproduceStage = workflow.stages.some((s) => /reproduce/i.test(s.id) || /reproduce/i.test(s.title));
    if (!hasReproduceStage) {
      warnings.push({
        type: 'debug-missing-reproduce-stage',
        stageId: 'workflow',
        message: 'debug 工作流建议包含可复现场景阶段（reproduce）（warning）。',
      });
    }

    const hasHypothesisStage = workflow.stages.some(
      (s) => /hypothesis|root_cause/i.test(s.id) || /假设|根因/.test(s.title),
    );
    if (!hasHypothesisStage) {
      warnings.push({
        type: 'debug-missing-hypothesis-stage',
        stageId: 'workflow',
        message: 'debug 工作流建议包含根因假设阶段（hypothesis/root-cause）（warning）。',
      });
    }

    const hasVerificationStage = workflow.stages.some(
      (s) => /^stage_test_run_/.test(s.id) || s.tool === 'code-runner',
    );
    if (!hasVerificationStage) {
      warnings.push({
        type: 'debug-missing-verification-stage',
        stageId: 'workflow',
        message: 'debug 工作流缺少可执行验证阶段（test_run/code-runner）（warning）。',
      });
    }

    // M22.3（I-26）：反馈回路优先 —— 复现/验证（code-runner）须在根因假设/修复之前出现
    const stages = workflow.stages;
    const firstFeedbackIdx = stages.findIndex(
      (s) => s.tool === 'code-runner' || /reproduce/i.test(s.id) || /reproduce/i.test(s.title),
    );
    const firstHypothesisOrFixIdx = stages.findIndex(
      (s) =>
        /hypothesis|root_cause/i.test(s.id) ||
        /假设|根因/.test(s.title) ||
        /^stage_impl_debug_/.test(s.id) ||
        /debug_fix/i.test(s.id),
    );
    if (
      firstHypothesisOrFixIdx >= 0 &&
      (firstFeedbackIdx < 0 || firstFeedbackIdx > firstHypothesisOrFixIdx)
    ) {
      warnings.push({
        type: 'debug-feedback-loop-not-first',
        stageId: 'workflow',
        message:
          'debug 工作流应「反馈回路优先」：可执行复现/回归（code-runner/reproduce）阶段须排在根因假设或修复实现之前（I-26，warning）。',
      });
    }

    const debugImplStages = workflow.stages.filter((s) => /^stage_impl_debug_/.test(s.id) || /debug_fix/i.test(s.id));
    for (const impl of debugImplStages) {
      const hasDecisionLikeSource = impl.input.sources.some(
        (src) =>
          src.type === 'stage-output' &&
          (src.outputKey === 'decisionRecord' || /hypothesis|assumption|analysis/i.test(src.outputKey || '')),
      );
      if (!hasDecisionLikeSource) {
        warnings.push({
          type: 'debug-impl-missing-decision-source',
          stageId: impl.id,
          message: 'debug 修复阶段建议绑定决策/假设类输入（decisionRecord/hypothesis）（warning）。',
        });
      }
    }
  }

  // M20.1：test_run 命令 import 须落在 artifact 登记内（与 validateGeneratedWorkflow 一致）
  for (let si = 0; si < workflow.stages.length; si++) {
    const s = workflow.stages[si];
    if (!/^stage_test_run_/.test(s.id) || s.tool !== 'code-runner') {
      continue;
    }
    const cmd = String((s.toolConfig as { command?: string }).command ?? '');
    const registry = collectWorkflowArtifacts(workflow);
    for (const issue of detectPythonImportLintIssues(cmd, registry, { stageId: s.id })) {
      violations.push({
        type: 'test-run-imports-missing-artifact',
        stageId: s.id,
        message: issue.message,
      });
    }
  }

  // P2: prototype 专项规则（warning-only，不阻断主流程）
  if (workflow.meta?.taskType === 'prototype') {
    const hasVerificationStage = workflow.stages.some(
      (s) => /^stage_test_run_/.test(s.id) || s.tool === 'code-runner',
    );
    if (!hasVerificationStage) {
      warnings.push({
        type: 'prototype-missing-verification-stage',
        stageId: 'workflow',
        message: 'prototype 工作流缺少实验验证阶段（test_run/code-runner）（warning）。',
      });
    }

    const hasSuccessCriteria = workflow.stages.some((s) => {
      const text = `${s.id} ${s.title} ${s.description ?? ''} ${String((s.toolConfig as { systemPrompt?: unknown })?.systemPrompt ?? '')}`;
      return /成功判据|失败判据|acceptance|success criteria|success metric/i.test(text);
    });
    // 已有可执行验证（code-runner / test_run）时，验收信号由命令 exitCode 承担，不再强制文案关键词
    if (!hasSuccessCriteria && !hasVerificationStage) {
      warnings.push({
        type: 'prototype-missing-success-criteria',
        stageId: 'workflow',
        message: 'prototype 工作流缺少成功/失败判据定义（warning）。',
      });
    }

    verifyPrototypeImplFileReadFollowup(workflow, warnings);
  }

  // P1: refactor 专项规则（warning-only，不阻断主流程）
  if (workflow.meta?.taskType === 'refactor') {
    const refactorDecides = workflow.stages.filter(
      (s) => s.isDecisionStage && /^stage_decide_refactor_/.test(s.id),
    );
    if (refactorDecides.length === 0) {
      warnings.push({
        type: 'refactor-missing-decision-stage',
        stageId: 'workflow',
        message: "refactor 工作流建议包含 stage_decide_refactor_<X> 决策阶段（warning）。",
      });
    }

    for (const impl of implStages) {
      if (/(all|core|everything|global|system)$/i.test(impl.id)) {
        warnings.push({
          type: 'refactor-monolithic-impl-naming',
          stageId: impl.id,
          message: 'refactor 实现阶段命名过于聚合，建议使用单切片语义命名（warning）。',
        });
      }
    }

    const hasVerificationStage = workflow.stages.some(
      (s) => /^stage_test_run_/.test(s.id) || s.tool === 'code-runner',
    );
    if (!hasVerificationStage) {
      warnings.push({
        type: 'refactor-missing-verification-stage',
        stageId: 'workflow',
        message: 'refactor 工作流缺少可执行验证阶段（test_run/code-runner）（warning）。',
      });
    }
  }

  if (workflow.globalConfig?.enableDagScheduler === true && workflow.stages?.length) {
    const cycleHint = formatWorkflowDependencyCycleError(workflow.stages);
    if (cycleHint) {
      warnings.push({
        type: 'dag-dependency-cycle-hint',
        stageId: 'workflow',
        message: `${cycleHint}（Rule20：与 validateGeneratedWorkflow 一致；请先修复后再依赖 DAG 执行。）`,
      });
    } else {
      const unreachable = findStageIdsUnreachableFromFirstStage(workflow.stages);
      if (unreachable.length > 0) {
        warnings.push({
          type: 'dag-unreachable-from-entry',
          stageId: 'workflow',
          message: `DAG 模式：以下阶段从 stages[0] 经依赖边不可达，可能为孤立子图或未挂到主链：${unreachable.slice(0, 12).join(', ')}${unreachable.length > 12 ? '…' : ''}`,
        });
      }
    }
  }

  // M22.2：horizontal TDD 反模式（全部测试在前、全部实现在后），与「一切片一循环」相悖（warning-only）
  if (isHorizontalTddPlan(workflow.stages ?? [])) {
    warnings.push({
      type: 'horizontal-tdd',
      stageId: 'workflow',
      message:
        '检测到 horizontal TDD：所有测试阶段排在所有实现阶段之前。建议改为「一切片一循环」（每个切片先红再绿）以缩短反馈回路（warning）。',
    });
  }

  return { passed: violations.length === 0, violations, warnings };
}

export { shouldWarnSoftwareMissingGlobalArchitectureDecision } from './rule20/architecture';
