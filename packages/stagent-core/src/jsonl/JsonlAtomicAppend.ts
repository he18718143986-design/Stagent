/**
 * JSONL / 日志行原子追加：文件锁 + 读-改-写 + tmp+rename，避免 appendFileSync 半行损坏。
 */
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteTextFileSync } from '../FsAsync';
import {
  JSONL_LOCK_MAX_WAIT_MS,
  JSONL_LOCK_STEP_MS,
  JSONL_LOCK_STALE_MS,
} from '../TimeConstants';

const DEFAULT_MAX_WAIT_MS = JSONL_LOCK_MAX_WAIT_MS;
const DEFAULT_STALE_MS = JSONL_LOCK_STALE_MS;
const DEFAULT_STEP_MS = JSONL_LOCK_STEP_MS;

function sleepSyncMs(ms: number): void {
  if (ms <= 0) {
    return;
  }
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer 不可用时退化为不等待 */
  }
}

function lockPathFor(filePath: string): string {
  return `${filePath}.lock`;
}

/** 同步 O_EXCL 文件锁；超时后 best-effort 仍执行 fn。 */
export function withSyncFileLock<T>(
  filePath: string,
  fn: () => T,
  opts: { maxWaitMs?: number; staleMs?: number; stepMs?: number } = {},
): T {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const stepMs = opts.stepMs ?? DEFAULT_STEP_MS;
  const lockPath = lockPathFor(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const start = Date.now();
  let fd: number | undefined;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > maxWaitMs) {
        return fn();
      }
      sleepSyncMs(stepMs);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 异步 O_EXCL 文件锁；超时后 best-effort 仍执行 fn（不阻塞 Extension Host）。 */
export async function withAsyncFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  opts: { maxWaitMs?: number; staleMs?: number; stepMs?: number } = {},
): Promise<T> {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const stepMs = opts.stepMs ?? DEFAULT_STEP_MS;
  const lockPath = lockPathFor(filePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  const start = Date.now();
  let fd: fs.promises.FileHandle | undefined;
  for (;;) {
    try {
      fd = await fs.promises.open(lockPath, 'wx');
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
      try {
        const st = await fs.promises.stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          await fs.promises.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > maxWaitMs) {
        return fn();
      }
      await sleepMs(stepMs);
    }
  }
  try {
    return await fn();
  } finally {
    if (fd !== undefined) {
      await fd.close().catch(() => undefined);
    }
    await fs.promises.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function rotateFileIfWouldExceedSync(filePath: string, incomingBytes: number, maxBytes: number): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    const size = fs.statSync(filePath).size;
    if (size + incomingBytes > maxBytes) {
      const rotated = `${filePath}.1`;
      fs.rmSync(rotated, { force: true });
      fs.renameSync(filePath, rotated);
    }
  } catch {
    /* 轮换 best-effort */
  }
}

function readExistingBody(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/** 去掉末尾不完整行（无换行结尾的残留），避免损坏 JSONL 拼接。 */
function stripTrailingPartialLine(body: string): string {
  if (!body) {
    return '';
  }
  const lastNl = body.lastIndexOf('\n');
  if (lastNl < 0) {
    return '';
  }
  return body.slice(0, lastNl + 1);
}

/**
 * 原子追加一行 JSONL（语义为 append，实现为整文件替换）。
 * `line` 应为单行 JSON，不含换行符。
 */
export function appendJsonlLineAtomicSync(filePath: string, line: string): void {
  const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
  withSyncFileLock(filePath, () => {
    const prior = stripTrailingPartialLine(readExistingBody(filePath));
    const body = prior.length > 0 ? `${prior}${normalized}\n` : `${normalized}\n`;
    atomicWriteTextFileSync(filePath, body);
  });
}

export interface AppendLogLineOptions {
  maxBytes?: number;
}

/** 原子追加一行纯文本日志；可选 maxBytes 轮换为 `.1` 备份。 */
export function appendLogLineAtomicSync(filePath: string, line: string, opts?: AppendLogLineOptions): void {
  const row = line.endsWith('\n') ? line : `${line}\n`;
  withSyncFileLock(filePath, () => {
    if (opts?.maxBytes != null && opts.maxBytes > 0) {
      rotateFileIfWouldExceedSync(filePath, Buffer.byteLength(row, 'utf-8'), opts.maxBytes);
    }
    const prior = readExistingBody(filePath);
    atomicWriteTextFileSync(filePath, prior.length > 0 ? `${prior}${row}` : row);
  });
}
