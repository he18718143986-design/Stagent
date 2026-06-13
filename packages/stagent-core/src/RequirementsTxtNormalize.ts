import { lintMsgForCode } from './l10n/lintMsg';

/** PyPI 上已知「易被模型幻觉」的包：错误主版本 → 建议钉法。 */
export const PYPI_PACKAGE_PIN_HINTS: Readonly<
  Record<string, { maxMajor: number; suggested: string; note: string }>
> = {
  ctpbee: {
    maxMajor: 1,
    suggested: 'ctpbee>=1.7.3,<2',
    note: 'PyPI 当前最高 1.7.x，无 8.x 线',
  },
};

export interface RequirementsTxtFix {
  line: number;
  before: string;
  after: string;
}

function parsePackageName(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }
  const m = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m?.[1]?.toLowerCase();
}

function parseMinMajorFromSpec(line: string): number | undefined {
  const m = line.match(/>=\s*(\d+)/);
  if (!m) {
    return undefined;
  }
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

function lineNeedsPinFix(line: string, pkgKey: string): boolean {
  const hint = PYPI_PACKAGE_PIN_HINTS[pkgKey];
  if (!hint) {
    return false;
  }
  const minMajor = parseMinMajorFromSpec(line);
  if (minMajor !== undefined && minMajor > hint.maxMajor) {
    return true;
  }
  // ctpbee==8.* / ctpbee>=8 等
  if (new RegExp(`\\b${pkgKey}\\b\\s*[=<>!~]+\\s*${hint.maxMajor + 1}`, 'i').test(line)) {
    return true;
  }
  return false;
}

/** 修正 requirements.txt 中不可能的 PyPI 版本钉（落盘时 + pip 前复用）。 */
export function normalizeRequirementsTxtContent(raw: string): {
  content: string;
  fixes: RequirementsTxtFix[];
} {
  const fixes: RequirementsTxtFix[] = [];
  const lines = raw.split('\n');
  const out = lines.map((line, idx) => {
    const pkg = parsePackageName(line);
    if (!pkg || !lineNeedsPinFix(line, pkg)) {
      return line;
    }
    const hint = PYPI_PACKAGE_PIN_HINTS[pkg]!;
    fixes.push({ line: idx + 1, before: line.trim(), after: hint.suggested });
    return hint.suggested;
  });
  const content = out.join('\n');
  return {
    content: content.endsWith('\n') || content.length === 0 ? content : `${content}\n`,
    fixes,
  };
}

export interface RequirementsTxtLintIssue {
  code: string;
  message: string;
  line?: number;
}

/** pip install -r 前校验；返回仍无法自动修复的 block 级问题。 */
export function lintRequirementsTxtContent(raw: string): RequirementsTxtLintIssue[] {
  const issues: RequirementsTxtLintIssue[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pkg = parsePackageName(line);
    if (!pkg) {
      continue;
    }
    if (lineNeedsPinFix(line, pkg)) {
      const hint = PYPI_PACKAGE_PIN_HINTS[pkg]!;
      issues.push({
        code: 'requirements-impossible-pypi-version',
        line: i + 1,
        message: lintMsgForCode(
          'requirements-impossible-pypi-version',
          pkg,
          line.trim(),
          hint.note,
          hint.suggested,
        ),
      });
    }
  }
  return issues;
}
