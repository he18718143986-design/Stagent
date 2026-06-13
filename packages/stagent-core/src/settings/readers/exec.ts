import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { DEFAULT_MAX_MANUAL_STAGE_RETRIES, normalizeMaxManualStageRetries } from '../../ManualRetryLimit';
import { readBlockDeliveryOnTestFailure } from '../../execution/DeliveryBlockOnTestFailure';
import {
  readConfigBooleanDefaultTrue,
  readConfigBooleanStrictTrue,
  readConfigResolved,
  readConfigStringEnum,
  readTriStateLintMode,
} from './readConfigHelpers';
import { readAfkEnabled, settingExplicitlyConfigured } from './afk';

export type PythonPypiSymbolLintMode = 'off' | 'warn' | 'hard';

/** vscode `stagent.sandbox.enabled`；默认 false */
export function readSandboxEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'sandbox.enabled');
}

/** vscode `stagent.sandbox.verificationOnly`；为 true 时仅 test_run/smoke 走沙箱（B-Q2）。AFK 默认 true。 */
export function readSandboxVerificationOnly(cfg?: WorkspaceConfiguration): boolean {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'sandbox.verificationOnly')) {
    return true;
  }
  return cfg?.get<boolean>('sandbox.verificationOnly') === true;
}

/** vscode `stagent.execution.testRunPreflight`；默认 true（M38.1 运行期 test_run 预检） */
export function readTestRunPreflightEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'execution.testRunPreflight');
}

/** vscode `stagent.execution.splitTestRunBundledCommands`；默认 true（M38.2 normalize 拆分 install&&test） */
export function readSplitTestRunBundledCommandsEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'execution.splitTestRunBundledCommands');
}

export type WriteOutputIntegrityMode = 'off' | 'warn' | 'retry';

/** vscode `stagent.execution.writeOutputIntegrity`；默认 retry（落盘 chars 与 LLM 差太多时自动重试一次）。 */
export function readWriteOutputIntegrityMode(cfg?: WorkspaceConfiguration): WriteOutputIntegrityMode {
  return readConfigStringEnum(
    cfg,
    'execution.writeOutputIntegrity',
    ['off', 'warn', 'retry'] as const,
    'retry',
  );
}

/** vscode `stagent.execution.testRunAutoNpmInstall`；默认 true（test_run 前在 effective cwd 自动 npm install）。 */
export function readTestRunAutoNpmInstallEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'execution.testRunAutoNpmInstall');
}

/** vscode `stagent.execution.testRunFailurePlaybook`；默认 true（M38.3 stderr 分类修复建议） */
export function readTestRunFailurePlaybookEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'execution.testRunFailurePlaybook');
}

/** M39.2：Decision ↔ impl ↔ test SDK/路径契约 lint 模式；默认 hard（test_run 前阻断） */
export type SdkPathContractLintMode = 'off' | 'warn' | 'hard';

export function readSdkPathContractLintMode(cfg?: WorkspaceConfiguration): SdkPathContractLintMode {
  return readTriStateLintMode(cfg, 'execution.sdkPathContractLint', 'hard');
}

/** Python test/impl 导出契约 lint；默认 warn（hard 时在 test_run 前阻断）。 */
export type PythonExportContractLintMode = 'off' | 'warn' | 'hard';

export function readPythonExportContractLintMode(
  cfg?: WorkspaceConfiguration,
): PythonExportContractLintMode {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'python.exportContractLint')) {
    return 'hard';
  }
  return readTriStateLintMode(cfg, 'python.exportContractLint', 'warn');
}

/** Python test_write 对照 decisionArtifacts.modules 契约；AFK 默认 hard。 */
export function readPythonModuleContractLintMode(
  cfg?: WorkspaceConfiguration,
): PythonExportContractLintMode {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'python.moduleContractLint')) {
    return 'hard';
  }
  return readTriStateLintMode(cfg, 'python.moduleContractLint', 'warn');
}

/** Python test_write 测试质量门禁（弱断言 only / sys.modules 劫持等假绿坏味）；AFK 默认 hard。 */
export function readTestQualityLintMode(
  cfg?: WorkspaceConfiguration,
): PythonExportContractLintMode {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'python.testQualityLint')) {
    return 'hard';
  }
  return readTriStateLintMode(cfg, 'python.testQualityLint', 'warn');
}

/** behaviorSpec P2 轻量 gate（条件 id 覆盖 / edge_rules 纪律）；AFK 默认 hard，其余默认 warn。 */
export function readBehaviorSpecLintMode(
  cfg?: WorkspaceConfiguration,
): PythonExportContractLintMode {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'python.behaviorSpecLint')) {
    return 'hard';
  }
  return readTriStateLintMode(cfg, 'python.behaviorSpecLint', 'warn');
}

/** demo 可体验交付总开关（生成 demo + 真跑一遍）；默认 false（价值档，按需开启，不影响 strict 正确性交付）。 */
export function readDemoDeliveryEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'delivery.demoDelivery');
}

/**
 * demo 产物客观验收 gate 模式（exit 0 / summary.json / QUICKSTART.md / 可选图表）。
 * demo 是价值档而非正确性档，默认 warn——即便 AFK 也不硬阻断正常交付；需要时显式置 hard。
 */
export function readDemoArtifactLintMode(
  cfg?: WorkspaceConfiguration,
): PythonExportContractLintMode {
  return readTriStateLintMode(cfg, 'delivery.demoArtifactLint', 'warn');
}

/** Python verify_imports --strict（stub 物化后 pre-impl 全量校验）；AFK 默认 true。 */
export function readPythonVerifyImportsStrict(cfg?: WorkspaceConfiguration): boolean {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'python.verifyImportsStrict')) {
    return true;
  }
  return readConfigBooleanStrictTrue(cfg, 'python.verifyImportsStrict');
}

/** Python 第三方 API 幻觉符号 lint（如 ctpbee MdApi）；默认 warn；hard 时 test_run 前阻断。 */
export function readPythonPypiSymbolLintMode(
  cfg?: WorkspaceConfiguration,
): PythonPypiSymbolLintMode {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'python.pypiSymbolLint')) {
    return 'hard';
  }
  return readTriStateLintMode(cfg, 'python.pypiSymbolLint', 'warn');
}

/** gate block 时尝试 LLM gate-repair（export-contract / pypi-symbol）；AFK 默认开启。 */
export function readGateAutoRepairEnabled(cfg?: WorkspaceConfiguration): boolean {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'execution.gateAutoRepair')) {
    return true;
  }
  return readConfigBooleanDefaultTrue(cfg, 'execution.gateAutoRepair');
}

/** gate-repair 仍失败时运行时插入 replan stage（P3b）；AFK 默认开启。 */
export function readRuntimeReplanEnabled(cfg?: WorkspaceConfiguration): boolean {
  if (readAfkEnabled(cfg) && !settingExplicitlyConfigured(cfg, 'execution.runtimeReplan')) {
    return true;
  }
  return readConfigBooleanDefaultTrue(cfg, 'execution.runtimeReplan');
}

/** software 默认 true；prototype 等默认 false。见 execution/DeliveryBlockOnTestFailure.ts */
export function readBlockDeliveryOnTestFailureSetting(
  cfg?: WorkspaceConfiguration,
  taskType?: string,
): boolean {
  return readBlockDeliveryOnTestFailure(cfg, taskType);
}

export type DangerousCommandLintMode = 'off' | 'warn' | 'hard';

/** vscode `stagent.execution.dangerousCommandLint`；默认 warn。 */
export function readDangerousCommandLintMode(cfg?: WorkspaceConfiguration): DangerousCommandLintMode {
  return readTriStateLintMode(cfg, 'execution.dangerousCommandLint');
}

/** vscode `stagent.maxManualStageRetries`；默认 3 / minimum 1 */
export function readMaxManualStageRetries(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'maxManualStageRetries',
    normalizeMaxManualStageRetries,
    DEFAULT_MAX_MANUAL_STAGE_RETRIES,
  );
}

/** 工作流生成 JSON 解析重试上限默认值（首次 + N-1 次自动重试）。 */
export const DEFAULT_MAX_WORKFLOW_PARSE_RETRIES = 2;

/** vscode `stagent.generation.maxParseRetries`；默认 2 / minimum 1（含首次尝试）。 */
export function readMaxWorkflowParseRetries(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'generation.maxParseRetries',
    (raw) => {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : NaN;
      return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_WORKFLOW_PARSE_RETRIES;
    },
    DEFAULT_MAX_WORKFLOW_PARSE_RETRIES,
  );
}
