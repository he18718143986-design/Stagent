/** 无法在 headless venv 中可靠 pip 安装的包（T4 Run #34/#37：talib 声明或 fix 写入 → pip 失败）。 */
export const BLOCKED_PIP_DEPENDENCIES = new Set([
  'talib',
  'ta-lib',
  'pandas-ta',
  'ta',
]);

export function isBlockedPipDependency(name: string): boolean {
  const pkg = name.trim().toLowerCase();
  return Boolean(pkg && BLOCKED_PIP_DEPENDENCIES.has(pkg));
}

export function filterBlockedPipDependencies(deps: Iterable<string>): string[] {
  const out: string[] = [];
  for (const dep of deps) {
    const pkg = dep.trim().toLowerCase();
    if (!pkg || isBlockedPipDependency(pkg)) {
      continue;
    }
    out.push(pkg);
  }
  return out;
}
