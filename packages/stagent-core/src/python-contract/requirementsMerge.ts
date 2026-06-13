import * as fs from 'fs';
import * as path from 'path';
import { isBlockedPipDependency } from './blockedPipDependencies';

export function packageNameFromRequirementLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }
  return trimmed.split(/[=<>!\[~;\s]/)[0]!.trim().toLowerCase();
}

/** 幂等合并依赖到 requirements.txt（不覆盖已有 pin）。 */
export function mergeDeclaredDependenciesIntoRequirements(
  workspaceRoot: string,
  deps: string[],
  reqRelPath = 'requirements.txt',
): { added: string[] } {
  const reqPath = path.join(workspaceRoot, reqRelPath);
  const existing = fs.existsSync(reqPath)
    ? fs.readFileSync(reqPath, 'utf8').split(/\r?\n/)
    : [];
  const lines = existing.map((l) => l.trimEnd()).filter((l, i, arr) => {
    if (i === arr.length - 1 && l === '') {
      return false;
    }
    return true;
  });
  const present = new Set(lines.map(packageNameFromRequirementLine).filter(Boolean));
  const added: string[] = [];
  for (const dep of deps) {
    const pkg = dep.toLowerCase();
    if (!pkg || present.has(pkg)) {
      continue;
    }
    lines.push(pkg);
    present.add(pkg);
    added.push(pkg);
  }
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  fs.writeFileSync(reqPath, body, 'utf8');
  return { added };
}

/**
 * 移除 requirements.txt 中未在 decisionArtifacts 声明的包（T4 Run #34：fix 写入 talib → pip 失败）。
 * 保留已声明包的 pin 行与注释。
 */
export function pruneUndeclaredRequirements(
  workspaceRoot: string,
  allowedDeps: string[],
  reqRelPath = 'requirements.txt',
): { removed: string[] } {
  const allowed = new Set(allowedDeps.map((d) => d.trim().toLowerCase()).filter(Boolean));
  const reqPath = path.join(workspaceRoot, reqRelPath);
  if (!fs.existsSync(reqPath)) {
    return { removed: [] };
  }
  const lines = fs.readFileSync(reqPath, 'utf8').split(/\r?\n/);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      continue;
    }
    const pkg = packageNameFromRequirementLine(trimmed);
    if (!pkg) {
      if (trimmed.startsWith('#')) {
        kept.push(trimmed);
      }
      continue;
    }
    if (isBlockedPipDependency(pkg)) {
      removed.push(pkg);
    } else if (allowed.has(pkg)) {
      kept.push(trimmed);
    } else {
      removed.push(pkg);
    }
  }
  fs.writeFileSync(reqPath, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  return { removed };
}

export function requirementsContentHash(workspaceRoot: string, reqRelPath = 'requirements.txt'): string | null {
  const reqPath = path.join(workspaceRoot, reqRelPath);
  if (!fs.existsSync(reqPath)) {
    return null;
  }
  const content = fs.readFileSync(reqPath, 'utf8');
  return content;
}
