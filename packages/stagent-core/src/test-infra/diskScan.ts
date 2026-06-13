import * as fs from 'fs';
import * as path from 'path';
import type { TestInfraArtifacts } from './artifacts';
import { mergeInfra } from './artifacts';
import { detectTestInfraArtifactsFromDir } from './detectTestInfraArtifacts';
import {
  BABEL_CONFIG_BASENAME,
  JEST_CONFIG_BASENAME,
  TSCONFIG_BASENAME,
} from './constants';

export { applyTestInfraBasename, detectTestInfraArtifactsFromDir } from './detectTestInfraArtifacts';

export type TestInfraArtifactKind = 'jest' | 'babel' | 'tsconfig';

export type TestInfraFoundEntry = {
  kind: TestInfraArtifactKind;
  relPath: string;
  inEffectiveCwd: boolean;
};

export type TestInfraDiscovery = {
  checkedDirs: string[];
  found: TestInfraFoundEntry[];
  satisfiedInEffectiveCwd: TestInfraArtifacts;
  merged: TestInfraArtifacts;
};

function classifyInfraBasename(basename: string): TestInfraArtifactKind | null {
  if (JEST_CONFIG_BASENAME.test(basename)) {
    return 'jest';
  }
  if (BABEL_CONFIG_BASENAME.test(basename)) {
    return 'babel';
  }
  if (TSCONFIG_BASENAME.test(basename)) {
    return 'tsconfig';
  }
  return null;
}

function listInfraInDir(
  dir: string,
  workspaceRoot: string,
  inEffectiveCwd: boolean,
): TestInfraFoundEntry[] {
  const entries: TestInfraFoundEntry[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return entries;
  }
  const rootResolved = path.resolve(workspaceRoot);
  for (const name of names) {
    const kind = classifyInfraBasename(name);
    if (!kind) {
      continue;
    }
    const abs = path.join(dir, name);
    const rel = path.relative(rootResolved, abs).replace(/\\/g, '/');
    entries.push({ kind, relPath: rel, inEffectiveCwd });
  }
  return entries;
}

export function scanTestInfraInDir(dir: string): TestInfraArtifacts {
  return detectTestInfraArtifactsFromDir(dir);
}

export function scanTestInfraOnDisk(workspaceRoot: string, cwd: string): TestInfraArtifacts {
  return discoverTestInfraOnDisk(workspaceRoot, cwd).merged;
}

export function discoverTestInfraOnDisk(workspaceRoot: string, effectiveCwd: string): TestInfraDiscovery {
  const rootResolved = path.resolve(workspaceRoot);
  const effectiveResolved = path.resolve(effectiveCwd);
  const checkedDirs =
    rootResolved === effectiveResolved
      ? [effectiveResolved]
      : [effectiveResolved, rootResolved];

  const found: TestInfraFoundEntry[] = [];
  const effectiveEntries = listInfraInDir(effectiveResolved, rootResolved, true);
  found.push(...effectiveEntries);

  if (rootResolved !== effectiveResolved) {
    const rootEntries = listInfraInDir(rootResolved, rootResolved, false);
    for (const entry of rootEntries) {
      if (!found.some((f) => f.kind === entry.kind && f.relPath === entry.relPath)) {
        found.push(entry);
      }
    }
  }

  // 浅层扫描 workspace 一级子目录，便于报告「配置在子目录但 effective cwd 未对齐」。
  try {
    const childNames = fs.readdirSync(rootResolved, { withFileTypes: true });
    for (const dirent of childNames) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const childDir = path.join(rootResolved, dirent.name);
      if (path.resolve(childDir) === effectiveResolved) {
        continue;
      }
      const childEntries = listInfraInDir(childDir, rootResolved, false);
      for (const entry of childEntries) {
        if (!found.some((f) => f.kind === entry.kind && f.relPath === entry.relPath)) {
          found.push(entry);
        }
      }
    }
  } catch {
    // ignore unreadable workspace root
  }

  const satisfiedInEffectiveCwd = scanTestInfraInDir(effectiveResolved);
  const merged =
    rootResolved === effectiveResolved
      ? satisfiedInEffectiveCwd
      : mergeInfra(satisfiedInEffectiveCwd, scanTestInfraInDir(rootResolved));

  return { checkedDirs, found, satisfiedInEffectiveCwd, merged };
}
