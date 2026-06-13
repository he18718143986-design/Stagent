import { isImplStageId } from '../workflow/StageIdPatterns';
import {
  codeRunnerCommandOf,
  writeOutputToFileOf,
} from '../workflow/StageToolConfigAccess';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import type { StructuralRepairPathConfidence } from './types';
import { STAGENT_REPAIR_MARKER } from './types';

export { codeRunnerCommandOf, writeOutputToFileOf };

const CODE_FILE_EXT = /\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;

/** 从 test_run command 解析 `cd <dir>`（与 test 实际 cwd 对齐）。 */
export function parseTestRunWorkingDir(command: string): string | undefined {
  const trimmed = command.trim();
  const m = /(?:^|[;&|]\s*)cd\s+([^\s;&|]+)/i.exec(trimmed);
  if (!m?.[1]) {
    return undefined;
  }
  const dir = m[1].trim().replace(/^["']|["']$/g, '');
  if (dir === '.' || dir === './') {
    return '';
  }
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

function dirnameOfRel(file: string): string {
  const n = file.replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  if (i <= 0) {
    return '';
  }
  return n.slice(0, i);
}

/** 在 test_run 之前推断配置落盘目录。 */
export function inferTestInfraDirectory(
  wf: WorkflowDefinition,
  testRunIndex: number,
): { dir: string; pathConfidence: StructuralRepairPathConfidence } {
  const testStage = wf.stages[testRunIndex];
  if (testStage) {
    const cmd = codeRunnerCommandOf(testStage);
    const cd = cmd ? parseTestRunWorkingDir(cmd) : undefined;
    if (cd !== undefined) {
      return { dir: cd, pathConfidence: 'high' };
    }
  }

  const counts = new Map<string, number>();
  for (let i = 0; i < testRunIndex; i++) {
    const s = wf.stages[i]!;
    if (!isImplStageId(s.id)) {
      continue;
    }
    const f = writeOutputToFileOf(s);
    if (!f || !CODE_FILE_EXT.test(f)) {
      continue;
    }
    const d = dirnameOfRel(f);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let bestDir = '';
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      bestN = n;
      bestDir = d;
    }
  }
  if (bestN >= 2) {
    return { dir: bestDir, pathConfidence: 'high' };
  }
  if (bestN === 1 && testRunIndex <= 4) {
    return { dir: bestDir, pathConfidence: 'high' };
  }
  return { dir: '', pathConfidence: 'deferred' };
}

export function joinConfigPath(dir: string, filename: string): string | undefined {
  if (!filename) {
    return undefined;
  }
  if (!dir) {
    return filename;
  }
  return `${dir}/${filename}`;
}

export function uniqueStageId(wf: WorkflowDefinition, preferred: string): string {
  if (!wf.stages.some((s) => s.id === preferred)) {
    return preferred;
  }
  for (let n = 2; n < 50; n++) {
    const id = `${preferred}_${n}`;
    if (!wf.stages.some((s) => s.id === id)) {
      return id;
    }
  }
  return `${preferred}_repair`;
}

export function mkRepairDescription(detail: string): string {
  return `${STAGENT_REPAIR_MARKER} ${detail}。仅调整计划顺序/结构；不保证配置文件内容正确，须执行本阶段后由 M38.1 检查磁盘。`;
}
