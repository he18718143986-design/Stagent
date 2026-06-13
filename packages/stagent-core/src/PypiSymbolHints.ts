export type PypiSymbolHint = {
  forbidden: string[];
  suggested: string;
  verifyImport: string;
};

/** 已知 PyPI 包幻觉符号表（包在 requirements ≠ 符号存在）。 */
export const PYPI_SYMBOL_HINTS: Record<string, PypiSymbolHint> = {
  ctpbee: {
    forbidden: ['MdApi', 'create_md_api'],
    suggested: 'CtpBee / CtpbeeApi（见 ctpbee 1.7.x）',
    verifyImport: 'from ctpbee import CtpBee',
  },
};

export function hintForPackage(pkg: string): PypiSymbolHint | undefined {
  return PYPI_SYMBOL_HINTS[pkg.toLowerCase()];
}

const FROM_IMPORT_LINE = /^\s*from\s+([a-zA-Z_][\w.]*)\s+import\s+([^\n#]+)/gm;

export type PypiSymbolLintIssue = {
  package: string;
  symbol: string;
  message: string;
  suggested: string;
};

/** 扫描 .py 源码中命中 forbidden 符号的 import。 */
export function lintPypiForbiddenImports(content: string): PypiSymbolLintIssue[] {
  const issues: PypiSymbolLintIssue[] = [];
  FROM_IMPORT_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FROM_IMPORT_LINE.exec(content)) !== null) {
    const pkg = m[1]!.split('.')[0]!.toLowerCase();
    const hint = hintForPackage(pkg);
    if (!hint) {
      continue;
    }
    const names = m[2]!
      .split(',')
      .map((n) => n.trim().split(/\s+as\s+/i)[0]!.trim())
      .filter(Boolean);
    for (const name of names) {
      if (hint.forbidden.includes(name)) {
        issues.push({
          package: pkg,
          symbol: name,
          message: `pypi-symbol-hint：${pkg} 不存在符号 ${name}；建议使用 ${hint.suggested}`,
          suggested: hint.suggested,
        });
      }
    }
  }
  return issues;
}

/** warn-only：从源码中移除 forbidden import 名（保留合法符号）。 */
export function stripForbiddenPypiImports(content: string): {
  content: string;
  stripped: PypiSymbolLintIssue[];
} {
  const stripped = lintPypiForbiddenImports(content);
  if (stripped.length === 0) {
    return { content, stripped: [] };
  }
  let next = content;
  for (const issue of stripped) {
    const re = new RegExp(
      `(from\\s+${issue.package}\\s+import\\s+)([^\\n#]+)`,
      'gi',
    );
    next = next.replace(re, (_full, prefix: string, names: string) => {
      const kept = names
        .split(',')
        .map((n) => n.trim())
        .filter((n) => {
          const base = n.split(/\s+as\s+/i)[0]!.trim();
          return base !== issue.symbol;
        });
      if (kept.length === 0) {
        return `# stripped forbidden import: ${issue.package}.${issue.symbol}\n`;
      }
      return `${prefix}${kept.join(', ')}`;
    });
  }
  return { content: next, stripped };
}
