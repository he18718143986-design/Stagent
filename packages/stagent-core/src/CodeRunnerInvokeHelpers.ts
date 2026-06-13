/**
 * code-runner 执行期策略：沙箱网络放行、超时秒数解析、生成工作流 timeout 字段归一化。
 */
import type { CodeRunnerConfig, WorkflowDefinition } from './WorkflowDefinition';

/** 常规 code-runner 默认超时（秒） */
export const DEFAULT_CODE_RUNNER_TIMEOUT_SEC = 60;

/** npm/pip/yarn/pnpm 等依赖安装命令的引擎底限（秒） */
export const DEPENDENCY_INSTALL_TIMEOUT_SEC = 300;

/** Python 冷启动重依赖 import 检查的引擎底限（秒） */
export const HEAVY_PYTHON_IMPORT_MIN_TIMEOUT_SEC = 90;

/** 命令是否需要访问 registry（沙箱开启时自动放行网络）。 */
export function commandNeedsNetworkAccess(command: string): boolean {
  const cmd = command.toLowerCase();
  if (/\bnpm\s+(install|ci)\b/.test(cmd)) {
    return true;
  }
  if (/\bnpm\s+i(?:\s|$|--|-)/.test(cmd) && !/\bnpm\s+init\b/.test(cmd)) {
    return true;
  }
  if (/\bpnpm\s+(install|add)\b/.test(cmd) || /\bpnpm\s+i(?:\s|$|--|-)/.test(cmd)) {
    return true;
  }
  if (/\byarn\s+(install|add)\b/.test(cmd)) {
    return true;
  }
  if (/\bpip3?\s+install\b/.test(cmd)) {
    return true;
  }
  if (/\bpython3?\s+-m\s+pip\s+install\b/.test(cmd)) {
    return true;
  }
  if (/\.venv\/bin\/python\s+-m\s+pip\s+install\b/.test(cmd)) {
    return true;
  }
  return false;
}

export function commandIsDependencyInstall(command: string): boolean {
  return commandNeedsNetworkAccess(command);
}

/** 生成器常误设 timeout 的「重」命令：安装或 Python 冷 import。 */
export function commandNeedsExtendedTimeout(command: string): boolean {
  return commandIsDependencyInstall(command) || commandHasHeavyPythonColdImport(command);
}

function commandHasHeavyPythonColdImport(command: string): boolean {
  return (
    /python3?\s+-c\s+['"][^'"]*\bimport\s+(pandas|numpy|scipy|lxml|PIL|matplotlib)\b/i.test(command) ||
    /\.venv\/bin\/python\s+-c\s+['"][^'"]*\bimport\s+(pandas|numpy|scipy|lxml|PIL|matplotlib)\b/i.test(
      command,
    )
  );
}

function timeoutFloorForCommand(command: string): number {
  if (commandIsDependencyInstall(command)) {
    return DEPENDENCY_INSTALL_TIMEOUT_SEC;
  }
  if (commandHasHeavyPythonColdImport(command)) {
    return HEAVY_PYTHON_IMPORT_MIN_TIMEOUT_SEC;
  }
  return DEFAULT_CODE_RUNNER_TIMEOUT_SEC;
}

/**
 * 解析 code-runner 超时秒数：未显式设置时用命令类别底限；显式设置时不得低于底限。
 */
export function resolveCodeRunnerTimeoutSeconds(command: string, explicit?: number): number {
  const floor = timeoutFloorForCommand(command);
  if (explicit != null && Number.isFinite(explicit)) {
    return Math.max(floor, Math.floor(explicit));
  }
  return floor;
}

/** 沙箱开启时：依赖安装类命令自动允许网络，其余仍阻断。 */
export function resolveSandboxNetworkAllowed(command: string): boolean {
  return commandNeedsNetworkAccess(command);
}

/**
 * 生成后归一化：去掉 LLM 误设的 timeout（如 install 阶段写 120s），由执行期统一解析。
 * 仅保留高于引擎底限的显式 timeout（例如 600s 超长安装）。
 */
export function normalizeCodeRunnerTimeoutsForWorkflow(wf: WorkflowDefinition): void {
  for (const stage of wf.stages ?? []) {
    if (stage.tool !== 'code-runner') {
      continue;
    }
    const tc = stage.toolConfig as CodeRunnerConfig;
    if (tc.type !== 'code-runner' || tc.timeout == null || !Number.isFinite(tc.timeout)) {
      continue;
    }
    const explicit = Math.floor(tc.timeout);
    const floor = timeoutFloorForCommand(tc.command);
    if (!commandNeedsExtendedTimeout(tc.command)) {
      delete tc.timeout;
      continue;
    }
    if (explicit <= floor) {
      delete tc.timeout;
    }
  }
}
