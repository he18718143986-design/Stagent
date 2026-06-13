/** code-runner 命令语义（webview-safe，无 fs/vscode）。 */

export const DEPENDENCY_INSTALL_PATTERN =
  /\bnpm\s+(ci|install)\b|\bpnpm\s+(install|i\b)|\byarn\s+(install|add)\b|\bpip3?\s+install\b|\bpython3?\s+-m\s+pip\s+install\b/i;

export const JS_TEST_RUN_PATTERN =
  /\b(jest|vitest|npx\s+jest|npm\s+test|yarn\s+test|pnpm\s+test|npm\s+run\s+test|yarn\s+run\s+test|pnpm\s+run\s+test)\b/i;

export const PYTHON_TEST_RUN_PATTERN = /\b(pytest|python\s+-m\s+pytest)\b/i;

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

export function commandLooksLikeDependencyInstallSegment(segment: string): boolean {
  return DEPENDENCY_INSTALL_PATTERN.test(segment);
}

export function commandLooksLikeTestRunSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) {
    return false;
  }
  return JS_TEST_RUN_PATTERN.test(trimmed) || PYTHON_TEST_RUN_PATTERN.test(trimmed);
}

export function commandSelfHasDependencyInstall(cmd: string): boolean {
  return commandLooksLikeDependencyInstallSegment(cmd);
}
