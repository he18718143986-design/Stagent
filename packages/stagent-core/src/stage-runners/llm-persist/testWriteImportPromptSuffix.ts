import * as path from 'path';
import { isImplStageId, isTestWriteStageId } from '../../workflow/StageIdPatterns';
import { writeOutputToFileOf } from '../../workflow/StageToolConfigAccess';
import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';

const IMPORTABLE_IMPL_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|dart|py)$/i;
const NON_IMPORTABLE_PATH =
  /(?:^|\/)(__tests__|tests?)(?:\/|$)|jest\.config|package\.json|tsconfig|babel\.config|\.(?:ya?ml|json|md|sh|dockerfile)$/i;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').trim();
}

function stackRootOf(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return null;
  }
  const slash = normalized.indexOf('/');
  if (slash < 0) {
    return '';
  }
  return normalized.slice(0, slash);
}

function stacksMatch(testStack: string | null, implStack: string | null): boolean {
  return testStack !== null && implStack !== null && testStack === implStack;
}

function isImportableImplArtifact(relPath: string): boolean {
  const n = normalizePath(relPath);
  if (!n || NON_IMPORTABLE_PATH.test(n)) {
    return false;
  }
  return IMPORTABLE_IMPL_EXT.test(n);
}

/** 相对测试文件目录的 import spec（TS/JS 去掉扩展名；Dart 保留 .dart）。 */
export function relativeImportSpecFromTestFile(testFilePath: string, implFilePath: string): string {
  const fromDir = path.posix.dirname(normalizePath(testFilePath));
  const toFile = normalizePath(implFilePath);
  let rel = path.posix.relative(fromDir, toFile);
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  if (/\.dart$/i.test(toFile)) {
    return rel;
  }
  return rel.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
}

export interface PlannedImportEntry {
  artifactPath: string;
  relativeImport: string;
}

export function collectPlannedImportEntriesForTestWrite(
  wf: WorkflowDefinition,
  testWriteStage: Stage,
): PlannedImportEntry[] {
  const testOut = writeOutputToFileOf(testWriteStage);
  if (!testOut) {
    return [];
  }
  const testStack = stackRootOf(testOut);
  const seen = new Set<string>();
  const entries: PlannedImportEntry[] = [];

  for (const stage of wf.stages ?? []) {
    if (!isImplStageId(stage.id)) {
      continue;
    }
    const artifact = writeOutputToFileOf(stage);
    if (!artifact || !isImportableImplArtifact(artifact)) {
      continue;
    }
    if (!stacksMatch(testStack, stackRootOf(artifact))) {
      continue;
    }
    const norm = normalizePath(artifact);
    if (norm === normalizePath(testOut) || seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    entries.push({
      artifactPath: norm,
      relativeImport: relativeImportSpecFromTestFile(testOut, norm),
    });
  }

  entries.sort((a, b) => a.artifactPath.localeCompare(b.artifactPath));
  return entries;
}

const MAX_LISTED_IMPORTS = 24;

/**
 * 运行时追加到 stage_test_write_* systemPrompt：列出同栈已计划 impl 落盘路径及相对 import。
 */
export function buildTestWriteImportPromptSuffix(
  wf: WorkflowDefinition,
  testWriteStage: Stage,
): string | undefined {
  if (!isTestWriteStageId(testWriteStage.id)) {
    return undefined;
  }
  const testOut = writeOutputToFileOf(testWriteStage);
  if (!testOut) {
    return undefined;
  }

  const entries = collectPlannedImportEntriesForTestWrite(wf, testWriteStage);
  const lines = [
    '【被测模块 import 约束（M39.3 运行时）】',
    `本测试将写入：${normalizePath(testOut)}`,
  ];

  if (entries.length === 0) {
    lines.push(
      '当前工作流同栈范围内无 impl 源码落盘路径；禁止相对 import 指向未计划的 ../src/* 等路径，请使用 mock/测试替身。',
    );
    return lines.join('\n');
  }

  lines.push('仅允许相对 import 以下已计划 impl 模块（禁止 ../src/app 等未列出路径）：');
  const listed = entries.slice(0, MAX_LISTED_IMPORTS);
  for (const e of listed) {
    lines.push(`- from '${e.relativeImport}'  （${e.artifactPath}）`);
  }
  if (entries.length > MAX_LISTED_IMPORTS) {
    lines.push(`- … 另有 ${entries.length - MAX_LISTED_IMPORTS} 个同栈 impl 路径未展开`);
  }

  return lines.join('\n');
}
