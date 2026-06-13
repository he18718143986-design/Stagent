/**
 * 生成 macOS `sandbox-exec` 用的 SBPL（Sandbox Profile Language）profile。
 *
 * 策略（后置规则覆盖前置）：
 *   1. (allow default)        —— 读/执行/系统调用放行，避免破坏 node/python 等工具链；
 *   2. (deny file-write*)     —— 先禁掉所有写；
 *   3. (allow file-write* …)  —— 仅放行 writeRoots（工作目录 + 临时目录）与 /dev/*；
 *   4. (deny network*)        —— 网络不放行时内核级断网（非环境变量软阻断）。
 *
 * 这是内核强制的写隔离：即便命令执行 `rm -rf ~` 或写 `~/.ssh`，也会被拒绝。
 *
 * 注意：`sandbox-exec` 被 Apple 标注为 deprecated，但当前 macOS 仍可用且无需特权；
 * 作为 VS Code 扩展内最实际的真隔离手段。
 */
export interface MacosSandboxProfileOptions {
  /** 允许写入的目录（应为 realpath 后的绝对路径）。 */
  writeRoots: string[];
  networkAllowed: boolean;
}

/** SBPL 字符串字面量：双引号包裹，转义反斜杠与双引号。 */
export function sbplStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildMacosSandboxProfile(opts: MacosSandboxProfileOptions): string {
  const lines: string[] = ['(version 1)', '(allow default)', '(deny file-write*)'];

  const allowWrite: string[] = ['(allow file-write*'];
  for (const root of opts.writeRoots) {
    if (root) {
      allowWrite.push(`  (subpath ${sbplStringLiteral(root)})`);
    }
  }
  // 终端/空设备等：很多工具会写 /dev/null、/dev/tty。
  allowWrite.push('  (regex #"^/dev/")');
  allowWrite.push(')');
  lines.push(...allowWrite);

  if (!opts.networkAllowed) {
    lines.push('(deny network*)');
  }

  return lines.join('\n');
}
