/**
 * M41：code-runner 执行层 — 从 WorkflowEngine 抽出 shell 执行与 cwd 解析。
 */
import * as path from 'path';
import type * as vscode from './platform/HostTypes';
import { spawnShellWithTimeout, spawnBoundedServe } from './process/ProcessRunner';
import { getMergedExecEnv } from './process/shellEnvironment';
import type { CodeRunnerConfig, ToolPathBase } from './WorkflowDefinition';
import {
  STAGE_INIT_NPM_WORKSPACE_ID,
  patchNpmDefaultTestScriptAfterInit,
} from './WorkflowDiskBootstrap';
import { codeRunnerTimeout, StagentError } from './ErrorTypeUtils';
import { ERROR_TYPE_CODE_RUNNER_TIMEOUT } from './errors/stageErrorBuilders';
import {
  resolveCodeRunnerTimeoutSeconds,
  resolveSandboxNetworkAllowed,
} from './CodeRunnerInvokeHelpers';
import { mapSandboxError, runInSandbox } from './SandboxExecutor';
import {
  resolveSandboxCapability,
  SandboxEnforcementUnavailableError,
  type SandboxCapabilityState,
} from './sandbox/SandboxCapabilityMatrix';
import { ERROR_TYPE_TOOL_EXECUTION_FAILED } from './errors/stageErrorBuilders';
import { resolveCodeRunnerExecutionContext } from './code-runner/effectiveCwd';
import {
  buildDeterministicExecEnv,
  pinInstallCommandForLockfile,
} from './quality-gates/deterministicVerification';
import { shouldSandboxCodeRunner } from './sandbox/resolveSandboxForStage';
import { applyPytestEnv } from './code-runner/pytestEnv';

export interface CodeRunnerHostDeps {
  ensureTaskDir: (instanceKey: string) => string;
  getWorkspaceRootAbsolute: () => string | undefined;
  safeJoinUnderWorkspaceRoot: (root: string, relativePath: string) => string;
  resolveTaskFilePath: (instanceKey: string, filePath: string) => string;
  postStreamChunk: (stageId: string, chunk: string) => void;
  warn: (message: string) => void;
  sandboxEnabled: boolean;
  sandboxVerificationOnly: boolean;
  /** 无 enforced 沙箱时询问用户是否以软约束继续；未提供则视为取消。 */
  confirmSoftConstraintSandbox?: (capability: SandboxCapabilityState) => Promise<boolean>;
  /** 子进程环境；默认合并登录 shell PATH（与集成终端一致）。 */
  resolveExecEnv?: () => NodeJS.ProcessEnv;
}

/** 本会话内用户已确认以软约束运行沙箱（一次性提示）。 */
let softConstraintAcknowledged = false;

/** 测试用：重置软约束确认状态。 */
export function resetSandboxSoftConstraintAckForTest(): void {
  softConstraintAcknowledged = false;
}

export function resolveCodeRunnerCwd(
  deps: CodeRunnerHostDeps,
  cfg: CodeRunnerConfig,
  instanceKey: string,
): string {
  const pathBase = cfg.pathBase ?? 'instance';
  if (pathBase === 'workspace') {
    const wr = deps.getWorkspaceRootAbsolute();
    if (!wr) {
      return deps.ensureTaskDir(instanceKey);
    }
    const wd = cfg.workingDir ?? '.';
    return path.isAbsolute(wd) ? wd : deps.safeJoinUnderWorkspaceRoot(wr, wd);
  }
  if (cfg.workingDir) {
    return path.isAbsolute(cfg.workingDir)
      ? cfg.workingDir
      : deps.resolveTaskFilePath(instanceKey, cfg.workingDir);
  }
  return deps.ensureTaskDir(instanceKey);
}

function patchInitWorkspaceTestScript(cwd: string, stageId: string, deps: CodeRunnerHostDeps): void {
  if (stageId !== STAGE_INIT_NPM_WORKSPACE_ID) {
    return;
  }
  try {
    patchNpmDefaultTestScriptAfterInit(cwd);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.warn(`patchNpmDefaultTestScriptAfterInit skipped: ${msg}`);
  }
}

export interface CodeRunnerExecutionOptions {
  deterministic?: boolean;
}

export async function runCodeRunnerCommand(
  deps: CodeRunnerHostDeps,
  cfg: CodeRunnerConfig,
  instanceKey: string,
  stageId: string,
  opts?: CodeRunnerExecutionOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let { effectiveCwd: cwd, command } = resolveCodeRunnerExecutionContext(deps, cfg, instanceKey);
  if (opts?.deterministic) {
    command = pinInstallCommandForLockfile(command, cwd);
  }
  const timeoutSec = resolveCodeRunnerTimeoutSeconds(command, cfg.timeout);
  const timeoutMs = timeoutSec * 1000;
  const baseEnv = deps.resolveExecEnv?.() ?? getMergedExecEnv();
  const mergedEnv = opts?.deterministic ? buildDeterministicExecEnv(baseEnv) : baseEnv;
  const execEnv = applyPytestEnv(command, mergedEnv);

  const useSandbox = shouldSandboxCodeRunner(stageId, cfg, {
    sandboxEnabled: deps.sandboxEnabled,
    verificationOnly: deps.sandboxVerificationOnly,
  });

  if (useSandbox) {
    const capability = resolveSandboxCapability();
    let requireEnforced = true;
    if (!capability.sandboxEnforced) {
      if (!softConstraintAcknowledged) {
        const ok = deps.confirmSoftConstraintSandbox
          ? await deps.confirmSoftConstraintSandbox(capability)
          : false;
        if (!ok) {
          throw new StagentError(
            ERROR_TYPE_TOOL_EXECUTION_FAILED,
            `tool-execution-failed: sandbox soft constraint declined (${capability.platform})`,
          );
        }
        softConstraintAcknowledged = true;
        deps.warn(`sandbox_soft_constraint_ack sandbox_mode=soft-constraint platform=${capability.platform}`);
      }
      requireEnforced = false;
    }
    try {
      const sandboxResult = await runInSandbox(command, cwd, {
        networkAllowed: resolveSandboxNetworkAllowed(command),
        timeoutSeconds: timeoutSec,
        requireEnforced,
        onStdoutChunk: (text) => deps.postStreamChunk(stageId, text),
        onStderrChunk: (text) => deps.postStreamChunk(stageId, text),
        onDegraded: (message) => deps.warn(`sandbox_degraded ${message}`),
      });
      if (sandboxResult.exitCode === 0) {
        patchInitWorkspaceTestScript(cwd, stageId, deps);
      }
      return {
        exitCode: sandboxResult.exitCode,
        stdout: sandboxResult.stdout,
        stderr: sandboxResult.stderr,
      };
    } catch (e) {
      if (e instanceof SandboxEnforcementUnavailableError) {
        throw new StagentError(
          ERROR_TYPE_TOOL_EXECUTION_FAILED,
          `tool-execution-failed: ${e.message}`,
        );
      }
      const mapped = mapSandboxError(e);
      if (mapped === ERROR_TYPE_CODE_RUNNER_TIMEOUT) {
        throw codeRunnerTimeout();
      }
      if (mapped) {
        // Carry the explicit sandbox error type so classifyThrownError + the error-card catalog
        // surface a sandbox-specific message instead of a raw "sandbox-error:" string.
        throw new StagentError(mapped, `sandbox-error:${mapped}`);
      }
      throw e;
    }
  }

  // B-Q1：长驻进程（smoke/e2e）走有界运行——起服务、探活/grace、收进程树，不等其自行退出。
  if (cfg.serve === true) {
    const served = await spawnBoundedServe(command, {
      cwd,
      env: execEnv,
      readyProbe: cfg.readyProbe,
      graceMs: cfg.graceMs,
      readyTimeoutMs: cfg.readyTimeoutMs ?? timeoutMs,
      onStdoutChunk: (text) => deps.postStreamChunk(stageId, text),
      onStderrChunk: (text) => deps.postStreamChunk(stageId, text),
    });
    if (served.ready) {
      return { exitCode: 0, stdout: served.stdout, stderr: served.stderr };
    }
    const reason = served.crashed
      ? `serve 启动后立即退出（exitCode=${served.exitCode ?? '?'}）`
      : served.timedOut
        ? 'serve 探活超时（进程在跑但始终未就绪）'
        : 'serve 未就绪';
    return {
      exitCode: served.exitCode && served.exitCode !== 0 ? served.exitCode : 1,
      stdout: served.stdout,
      stderr: `${served.stderr}\n[smoke] ${reason}`,
    };
  }

  const result = await spawnShellWithTimeout(command, {
    cwd,
    timeoutMs,
    env: execEnv,
    onStdoutChunk: (text) => deps.postStreamChunk(stageId, text),
    onStderrChunk: (text) => deps.postStreamChunk(stageId, text),
  });
  if (result.timedOut) {
    throw codeRunnerTimeout();
  }
  if (result.exitCode === 0) {
    patchInitWorkspaceTestScript(cwd, stageId, deps);
  }
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

/** 供 ExecutionBinder 类型引用（保持与引擎 runCodeRunner 签名一致）。 */
export type CodeRunnerPanel = vscode.WebviewPanel;
