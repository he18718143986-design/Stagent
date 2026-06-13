import * as path from 'path';

let extensionRootOverride: string | undefined;

/** 测试或装配层注入扩展根目录（含 scripts/）。 */
export function setExtensionRootForScripts(root: string | undefined): void {
  extensionRootOverride = root;
}

/**
 * 解析扩展内置 scripts/*.mjs 的绝对路径。
 * 编译产物在 out/，scripts 在包根 scripts/。
 */
export function resolveExtensionScriptPath(scriptName: string): string {
  const root = extensionRootOverride ?? path.join(__dirname, '..', '..');
  return path.join(root, 'scripts', scriptName);
}

/** 生成可在 shell 中安全引用的 node 命令。 */
export function buildNodeExtensionScriptCommand(scriptName: string, args: string[]): string {
  const scriptPath = resolveExtensionScriptPath(scriptName);
  const quoted = args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return `node "${scriptPath}"${quoted.length ? ` ${quoted.join(' ')}` : ''}`;
}
