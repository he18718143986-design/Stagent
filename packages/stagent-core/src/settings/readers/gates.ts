import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { DEFAULT_RED_GREEN_MODE, resolveRedGreenMode, type RedGreenMode } from '../../RedGreenGate';
import {
  readConfigBooleanDefaultTrue,
  readConfigBooleanStrictTrue,
  readConfigRaw,
  readConfigResolved,
  readConfigStringEnum,
} from './readConfigHelpers';

/** vscode `stagent.tdd.redGreenGate`；M22.1，默认 'warn'（off=关闭/warn=仅告警/hard=GREEN-before-impl 阻断） */
export function readRedGreenGateMode(cfg?: WorkspaceConfiguration): RedGreenMode {
  return readConfigResolved(cfg, 'tdd.redGreenGate', resolveRedGreenMode, DEFAULT_RED_GREEN_MODE);
}

/** M22.3（I-26）：debug 反馈回路优先 — off / warn（仅 Rule20 warning）/ hard（生成期 violation + 运行期阻断） */
export type DebugFeedbackLoopMode = 'off' | 'warn' | 'hard';

export function readDebugFeedbackLoopMode(cfg?: WorkspaceConfiguration): DebugFeedbackLoopMode {
  const raw = readConfigRaw(cfg, 'debug.requireFeedbackLoop');
  if (raw === 'off' || raw === 'warn' || raw === 'hard') {
    return raw;
  }
  if (raw === false) {
    return 'off';
  }
  return 'hard';
}

/** 运行期 hypothesis/impl 前是否 HARD 阻断（仅 hard 模式） */
export function readDebugFeedbackLoopRuntimeHard(cfg?: WorkspaceConfiguration): boolean {
  return readDebugFeedbackLoopMode(cfg) === 'hard';
}

/** @deprecated 使用 readDebugFeedbackLoopRuntimeHard */
export function readDebugRequireFeedbackLoop(cfg?: WorkspaceConfiguration): boolean {
  return readDebugFeedbackLoopRuntimeHard(cfg);
}

/** vscode `stagent.plan.requireCompleteness`；M27.1，默认 true（多文件 prototype/software 计划缺验证/装配即硬阻断） */
export function readPlanCompletenessGateEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'plan.requireCompleteness');
}

/** vscode `stagent.plan.structuralRepair`；M40.0，默认 off（auto=计划完整性门禁后确定性插入阶段） */
export type PlanStructuralRepairMode = 'off' | 'auto';

export function readPlanStructuralRepairMode(cfg?: WorkspaceConfiguration): PlanStructuralRepairMode {
  return readConfigStringEnum(cfg, 'plan.structuralRepair', ['off', 'auto'] as const, 'off');
}

/** vscode `stagent.enableRuntimeRule20Verify`；默认 true（显式 false 回滚 v2.7） */
export function readRuntimeRule20VerifyEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'enableRuntimeRule20Verify');
}

/** Phase 4（可选）：to-issues horizontal-tdd 观测升 fail；默认 false */
export function readToIssuesHorizontalLayeringFail(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'toIssues.horizontalLayeringFail');
}

/** ADR-0009：horizontal TDD 反模式升 hard（多切片必须一切片一循环）；默认 false（保持 warning） */
export function readHorizontalTddFail(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'tdd.horizontalTddFail');
}

/** M18.2：静态分析管道接入热路径；默认 false（灰度） */
export function readStaticAnalysisEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'staticAnalysis.enabled');
}

/** vscode `stagent.grill.adaptiveMode`；M23，默认 false（开启自适应「一次一问」grill） */
export function readGrillAdaptiveModeEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'grill.adaptiveMode');
}

/** vscode `stagent.glossary.enabled`；M24，默认 true（活 CONTEXT.md 词汇表 + ADR 留存） */
export function readGlossaryEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'glossary.enabled');
}

/** vscode `stagent.architecture.depthScoring`；M25，默认 false（深模块评分接入质量分） */
export function readArchitectureDepthScoringEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'architecture.depthScoring');
}

/**
 * vscode `stagent.autoInsertGlobalArchitectureDecision`；默认 false。
 * 为 true 时，多模块 software 计划在 verify 前可插入 `stage_decide_architecture_overview` 空壳，并追加 SOFT warning。
 */
export function readAutoInsertGlobalArchitectureDecisionEnabled(
  cfg?: WorkspaceConfiguration,
): boolean {
  return readConfigBooleanStrictTrue(cfg, 'autoInsertGlobalArchitectureDecision');
}
