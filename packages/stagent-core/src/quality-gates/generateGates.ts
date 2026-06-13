/**
 * generate 阶段内置 QualityGate（从 BuiltinQualityGates.ts 抽出，1.3）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { QualityGate } from '../QualityGate';
import { verifyRule20 } from '../Rule20Verify';
import {
  formatHardPlanCompletenessBlockReason,
  formatRule20ViolationsBlockReason,
  hardBlockPlanCompletenessIssues,
  shouldBlockGenerateOnRule20Violations,
} from '../GeneratedWorkflowGate';
import { lintPlanCompleteness, formatPlanCompletenessBlockReason } from '../PlanCompletenessGate';
import { isSoftwareTaskType } from '../workflow/TaskType';
import { validateAndPrepareGeneratedWorkflow } from '../WorkflowEngineHelpers';
import { buildGeneratorWarnings } from '../Rule20RuntimeGate';
import { buildAutoInsertedGlobalArchitectureWarningLine } from '../WorkflowRule20Normalize';
import {
  buildTaskTypeOverrideWarning,
  isAutoTaskType,
  isKnownTaskType,
} from '../TaskTypeResolution';
import { dependencyGraphToWarningLines } from '../DependencyGraphAnalyzer';
import { complexityEstimateToWarningLines } from '../WorkflowComplexityEstimator';
import { GENERATION_STAGE_SOFT_CAP } from '../workflow/WorkflowStageBudget';
import { WORKSPACE_TSCONFIG_JSON } from '../workspace/WorkspaceRootFilenames';
import { lintPrototypeDataContract } from '../PrototypeContractLint';
import { structuralRepairWarningLines, type StructuralRepairAction } from '../WorkflowStructuralRepair';
import {
  analysisResultsToWarningLines,
  buildDefaultWorkspaceChecks,
  runStaticAnalysis,
  suggestVerificationStages,
} from '../StaticAnalysisPipeline';
import {
  GATE_ID_COMPLEXITY_WARNINGS,
  GATE_ID_DEPENDENCY_GRAPH_WARNINGS,
  GATE_ID_GENERATOR_META_WARNINGS,
  GATE_ID_PLAN_COMPLETENESS,
  GATE_ID_PLAN_COMPLETENESS_HARD,
  GATE_ID_PROTOTYPE_DATA_CONTRACT,
  GATE_ID_RULE20_VIOLATIONS,
  GATE_ID_SCHEMA_VALIDATION,
  GATE_ID_STATIC_ANALYSIS_ON_GENERATE,
} from '../QualityGateIds';
import { block, warn } from './gateHelpers';

export const BUILTIN_GENERATE_GATES: QualityGate[] = [
  {
    id: GATE_ID_SCHEMA_VALIDATION,
    label: '工作流字段/schema 校验',
    phase: 'generate',
    priority: 10,
    evaluate(ctx) {
      if (!ctx.workflow || !ctx.effectiveTaskType) {
        return null;
      }
      const prepared = validateAndPrepareGeneratedWorkflow(ctx.workflow, ctx.effectiveTaskType);
      if (prepared.errors.length === 0) {
        return null;
      }
      return block(GATE_ID_SCHEMA_VALIDATION, prepared.errors, { workflow: prepared.workflow });
    },
  },
  {
    id: GATE_ID_RULE20_VIOLATIONS,
    label: 'Rule20 运行时校验（violations 阻断）',
    phase: 'generate',
    priority: 20,
    enabled: (ctx) => ctx.runtimeRule20On === true && !!ctx.workflow,
    evaluate(ctx) {
      const wf = ctx.workflow!;
      const gates = ctx.generationGates;
      const verifyResult =
        ctx.verifyResult ??
        verifyRule20(wf);
      if (!shouldBlockGenerateOnRule20Violations(verifyResult, ctx.runtimeRule20On === true)) {
        return null;
      }
      return block(GATE_ID_RULE20_VIOLATIONS, [formatRule20ViolationsBlockReason(verifyResult!.violations)], {
        verifyResult,
      });
    },
  },
  {
    id: GATE_ID_PLAN_COMPLETENESS_HARD,
    label: '计划完整性硬阻断（TDD 链）',
    phase: 'generate',
    priority: 25,
    enabled: (ctx) => !!ctx.workflow && !!ctx.effectiveTaskType && isSoftwareTaskType(ctx.effectiveTaskType),
    evaluate(ctx) {
      const hardIssues = hardBlockPlanCompletenessIssues(ctx.workflow!, ctx.effectiveTaskType!);
      if (hardIssues.length === 0) {
        return null;
      }
      return block(GATE_ID_PLAN_COMPLETENESS_HARD, [formatHardPlanCompletenessBlockReason(hardIssues)], {
        issues: hardIssues,
      });
    },
  },
  {
    id: GATE_ID_PLAN_COMPLETENESS,
    label: '计划完整性（M27/M39）',
    phase: 'generate',
    priority: 30,
    enabled: (ctx) => ctx.generationGates?.planCompletenessEnabled === true && !!ctx.workflow,
    evaluate(ctx) {
      const issues = lintPlanCompleteness(ctx.workflow!);
      if (issues.length === 0) {
        return null;
      }
      return block(GATE_ID_PLAN_COMPLETENESS, [formatPlanCompletenessBlockReason(issues)], { issues });
    },
  },
  {
    id: GATE_ID_GENERATOR_META_WARNINGS,
    label: '生成元数据 / 阶段规模 warnings',
    phase: 'generate',
    priority: 100,
    enabled: (ctx) => !!ctx.workflow,
    evaluate(ctx) {
      const wf = ctx.workflow!;
      const messages = buildGeneratorWarnings({
        stageCount: wf.stages.length,
        maxStageWarn: ctx.maxStageWarn ?? GENERATION_STAGE_SOFT_CAP,
        verifyResult: ctx.verifyResult,
        enableRuntimeRule20Verify: ctx.runtimeRule20On === true,
      });
      const autoArch = buildAutoInsertedGlobalArchitectureWarningLine(wf);
      if (autoArch) {
        messages.push(autoArch);
      }
      const overrideWarn = buildTaskTypeOverrideWarning(
        ctx.uiTaskType ?? wf.meta.taskType,
        ctx.modelTaskType,
        ctx.effectiveTaskType as Parameters<typeof buildTaskTypeOverrideWarning>[2],
      );
      if (overrideWarn) {
        messages.push(overrideWarn);
      }
      if (ctx.uiTaskType && isAutoTaskType(ctx.uiTaskType)) {
        if (!ctx.modelTaskType?.trim()) {
          messages.push(`taskType:missing-meta:fallback-${ctx.effectiveTaskType}`);
        } else if (!isKnownTaskType(ctx.modelTaskType)) {
          messages.push(`taskType:invalid-meta:${ctx.modelTaskType}:using-${ctx.effectiveTaskType}`);
        }
      }
      const repairs = ctx.structuralRepairs as StructuralRepairAction[] | undefined;
      if (repairs?.length) {
        messages.push(...structuralRepairWarningLines(repairs));
      }
      return messages.length ? warn(GATE_ID_GENERATOR_META_WARNINGS, messages) : null;
    },
  },
  {
    id: GATE_ID_DEPENDENCY_GRAPH_WARNINGS,
    label: '依赖图 warnings',
    phase: 'generate',
    priority: 110,
    enabled: (ctx) => !!ctx.depGraph,
    evaluate(ctx) {
      const messages = dependencyGraphToWarningLines(ctx.depGraph!);
      return messages.length ? warn(GATE_ID_DEPENDENCY_GRAPH_WARNINGS, messages) : null;
    },
  },
  {
    id: GATE_ID_COMPLEXITY_WARNINGS,
    label: '复杂度估算 warnings',
    phase: 'generate',
    priority: 120,
    enabled: (ctx) => !!ctx.complexity,
    evaluate(ctx) {
      const messages = complexityEstimateToWarningLines(ctx.complexity!);
      return messages.length ? warn(GATE_ID_COMPLEXITY_WARNINGS, messages) : null;
    },
  },
  {
    id: GATE_ID_PROTOTYPE_DATA_CONTRACT,
    label: 'Prototype DATA_SCHEMA 契约 warnings',
    phase: 'generate',
    priority: 130,
    enabled: (ctx) => !!ctx.workflow,
    evaluate(ctx) {
      const messages = lintPrototypeDataContract(ctx.workflow!);
      return messages.length ? warn(GATE_ID_PROTOTYPE_DATA_CONTRACT, messages) : null;
    },
  },
  {
    id: GATE_ID_STATIC_ANALYSIS_ON_GENERATE,
    label: '生成期工作区静态分析',
    phase: 'generate',
    priority: 140,
    tags: ['static-analysis'],
    enabled: (ctx) =>
      ctx.generationGates?.staticAnalysisEnabled === true && !!ctx.taskWorkspaceAbs,
    async evaluate(ctx) {
      const ws = ctx.taskWorkspaceAbs!;
      const checks = buildDefaultWorkspaceChecks(ws);
      if (checks.length === 0) {
        return null;
      }
      const analysisResults = await runStaticAnalysis(checks, ws);
      const messages = analysisResultsToWarningLines(analysisResults);
      const suggested = suggestVerificationStages(analysisResults, ctx.workflow!.stages);
      if (suggested.length > 0) {
        messages.push('static-analysis:suggest-tsc-stage');
      }
      if (fs.existsSync(path.join(ws, WORKSPACE_TSCONFIG_JSON))) {
        messages.push('static-analysis:typescript:recommend-post-impl');
      }
      return messages.length ? warn(GATE_ID_STATIC_ANALYSIS_ON_GENERATE, messages) : null;
    },
  },
];
