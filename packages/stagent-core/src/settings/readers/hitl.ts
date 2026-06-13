import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import type { GlobalDecisionInjectMode } from '../../WorkflowDefinition';
import type { HITLDecisionMode } from '../../AdaptiveHITLPolicy';
import {
  DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
  DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD,
  resolveConfidencePauseThreshold,
  resolveContractNodePauseThreshold,
} from '../../StagentSettingsDefaults';
import {
  readConfigBooleanDefaultTrue,
  readConfigResolved,
  readConfigStringEnum,
} from './readConfigHelpers';
import { readAfkEnabled, settingExplicitlyConfigured } from './afk';

const AFK_CONFIDENCE_PAUSE_THRESHOLD = 0.35;

/** vscode `stagent.hitl.contractNodePauseThreshold`；M21.4，默认 0.75 */
export function readContractNodePauseThreshold(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'hitl.contractNodePauseThreshold',
    resolveContractNodePauseThreshold,
    DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD,
  );
}

/** vscode `stagent.hitl.pauseContractNodes`；M21.4，默认 true（false 回滚至纯 confidence 阈值） */
export function readPauseContractNodesEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'hitl.pauseContractNodes');
}

/** vscode `stagent.confidence.pauseThreshold`；M16.2 AdaptiveHITL 将消费，M15.7 仅引擎读取并写 debug 日志 */
export function readConfidencePauseThreshold(cfg?: WorkspaceConfiguration): number {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'confidence.pauseThreshold')) {
    return AFK_CONFIDENCE_PAUSE_THRESHOLD;
  }
  return readConfigResolved(
    cfg,
    'confidence.pauseThreshold',
    resolveConfidencePauseThreshold,
    DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
  );
}

/** vscode `stagent.enableDecisionContentLint`；默认 true（workflow globalConfig 可覆盖） */
export function readDecisionContentLintEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'enableDecisionContentLint');
}

/** vscode `stagent.injectApprovedDecisionContext`；默认 true */
export function readInjectApprovedDecisionContext(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'injectApprovedDecisionContext');
}

/** vscode `stagent.globalDecisionInjectMode`；默认 summary */
export function readGlobalDecisionInjectMode(
  cfg?: WorkspaceConfiguration,
): GlobalDecisionInjectMode {
  return readConfigStringEnum(cfg, 'globalDecisionInjectMode', ['full', 'summary'] as const, 'summary');
}

/** vscode `stagent.hitl.decisionMode`；默认 inline-pause（B-R2 决策前置为 frontloaded） */
export function readHitlDecisionMode(cfg?: WorkspaceConfiguration): HITLDecisionMode {
  return readConfigStringEnum(cfg, 'hitl.decisionMode', ['inline-pause', 'frontloaded'] as const, 'inline-pause');
}
