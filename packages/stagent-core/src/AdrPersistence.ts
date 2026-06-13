/**
 * M34 / #13：ADR 磁盘读写（`.stagent/adr/`）。纯 fs 封装，无 vscode 依赖。
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  adrFileName,
  buildAdrRecordFromDecision,
  formatAdrIndexForPrompt,
  nextAdrNumber,
  parseAdrSummary,
  renderAdrMarkdown,
  shouldCreateAdr,
  type AdrRecord,
  type ShouldCreateAdrInput,
} from './AdrStore';
import {
  atomicWriteTextFile,
  DEFAULT_FS_READ_TIMEOUT_MS,
  ensureDir,
  pathExists,
  readTextFile,
} from './FsAsync';
import { adrDir } from './paths/StagentPaths';

export function resolveAdrDir(workspaceRoot: string): string {
  return adrDir(workspaceRoot);
}

export async function listAdrFileNames(adrDir: string): Promise<string[]> {
  if (!(await pathExists(adrDir))) {
    return [];
  }
  const names = await fs.readdir(adrDir);
  return names.filter((n) => n.endsWith('.md'));
}

export async function persistAdrRecord(adrDir: string, adr: AdrRecord): Promise<string> {
  await ensureDir(adrDir);
  const filePath = path.join(adrDir, adrFileName(adr));
  await atomicWriteTextFile(filePath, renderAdrMarkdown(adr));
  return filePath;
}

/** 决策批准后：三门判定 → 编号 → 落盘；不满足三门则跳过（不阻断）。 */
export async function persistAdrOnDecisionApprove(
  workspaceRoot: string,
  input: ShouldCreateAdrInput,
): Promise<{ written: boolean; filePath?: string; skipReason?: string }> {
  const gate = shouldCreateAdr(input);
  if (!gate.create) {
    return { written: false, skipReason: `gates=${gate.reasons.join(',') || 'none'}` };
  }
  const adrDir = resolveAdrDir(workspaceRoot);
  const existing = await listAdrFileNames(adrDir);
  const number = nextAdrNumber(existing);
  const adr = buildAdrRecordFromDecision({ ...input, number });
  const filePath = await persistAdrRecord(adrDir, adr);
  return { written: true, filePath };
}

/** 读取工作区已有 ADR，格式化为生成器 prompt 块。 */
export async function buildAdrContextForWorkspace(workspaceRoot: string): Promise<string> {
  const adrDir = resolveAdrDir(workspaceRoot);
  const names = await listAdrFileNames(adrDir);
  if (names.length === 0) {
    return '';
  }
  const summaries = (
    await Promise.all(
      names.map(async (name) => {
        try {
          const raw = await readTextFile(path.join(adrDir, name), {
            timeoutMs: DEFAULT_FS_READ_TIMEOUT_MS,
          });
          return parseAdrSummary(raw);
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((s): s is NonNullable<typeof s> => s !== undefined);
  return formatAdrIndexForPrompt(summaries);
}
