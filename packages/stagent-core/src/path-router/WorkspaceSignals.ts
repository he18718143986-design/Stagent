import * as fs from 'fs';
import * as path from 'path';
import type { CodebaseSnapshot } from '../CodebaseContextProvider';
import { listSourceFiles } from '../workspace/listSourceFiles';
import { DEFAULT_WORKSPACE_SKIP_DIR_NAMES as SKIP_DIR_NAMES } from '../workspace/WorkspaceSkipDirs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.vue']);

/** 判定「已有 substantial 代码」的阈值（对齐 WORKFLOW §4.1）。 */
export const SUBSTANTIAL_SOURCE_FILE_MIN = 3;
export const SUBSTANTIAL_LOC_MIN = 150;
export const SUBSTANTIAL_MODULE_MIN = 2;

export interface WorkspaceSignals {
  hasContextMd: boolean;
  hasDocsAgents: boolean;
  sourceFileCount: number;
  totalLoc: number;
  moduleCount: number;
  topLevelFileCount: number;
  hasSubstantialCode: boolean;
}

function countDocsAgentsFiles(taskWorkspaceAbs: string): boolean {
  const agentsDir = path.join(taskWorkspaceAbs, 'docs', 'agents');
  if (!fs.existsSync(agentsDir)) {
    return false;
  }
  try {
    return fs.readdirSync(agentsDir).some((name) => !name.startsWith('.'));
  } catch {
    return false;
  }
}

function countTopLevelFiles(taskWorkspaceAbs: string): number {
  try {
    return fs
      .readdirSync(taskWorkspaceAbs, { withFileTypes: true })
      .filter((d) => d.isFile() && !d.name.startsWith('.')).length;
  } catch {
    return 0;
  }
}

function countSourceFiles(taskWorkspaceAbs: string): number {
  return listSourceFiles(taskWorkspaceAbs, {
    maxFiles: 512,
    maxDepth: 8,
    extensions: SOURCE_EXTENSIONS,
    skipDirNames: SKIP_DIR_NAMES,
  }).length;
}

function locFromSnapshot(snapshot?: CodebaseSnapshot): { totalLoc: number; moduleCount: number } {
  const modules = snapshot?.existingModules ?? [];
  const totalLoc = modules.reduce((sum, m) => sum + (m.linesOfCode ?? 0), 0);
  return { totalLoc, moduleCount: modules.length };
}

export function scanWorkspaceSignals(
  taskWorkspaceAbs: string,
  snapshot?: CodebaseSnapshot,
): WorkspaceSignals {
  const hasContextMd = fs.existsSync(path.join(taskWorkspaceAbs, 'CONTEXT.md'));
  const hasDocsAgents = countDocsAgentsFiles(taskWorkspaceAbs);
  const sourceFileCount = countSourceFiles(taskWorkspaceAbs);
  const topLevelFileCount = countTopLevelFiles(taskWorkspaceAbs);
  const { totalLoc, moduleCount } = locFromSnapshot(snapshot);

  const hasSubstantialCode =
    sourceFileCount >= SUBSTANTIAL_SOURCE_FILE_MIN ||
    totalLoc >= SUBSTANTIAL_LOC_MIN ||
    moduleCount >= SUBSTANTIAL_MODULE_MIN;

  return {
    hasContextMd,
    hasDocsAgents,
    sourceFileCount,
    totalLoc,
    moduleCount,
    topLevelFileCount,
    hasSubstantialCode,
  };
}
