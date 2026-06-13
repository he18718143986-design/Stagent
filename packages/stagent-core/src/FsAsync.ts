/**
 * #7 / M33：异步 fs 薄封装。热路径（阶段执行、状态持久化、会话日志）统一走此模块，
 * 避免 `readFileSync` / `writeFileSync` 阻塞 Extension Host 主线程。
 */
import * as fs from 'fs';
import * as path from 'path';

const fsp = fs.promises;

/** 热路径异步读文件默认上限（毫秒）；仅当调用方传入 `timeoutMs` 时生效。 */
export const DEFAULT_FS_READ_TIMEOUT_MS = 60_000;

export interface ReadTextFileOptions {
  timeoutMs?: number;
}

/** 路径是否存在（`access` 探测，不抛错）。 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 确保目录存在。 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

/** 读取 UTF-8 文本；文件不存在则抛错。可选 `timeoutMs` 防止 FS 挂起。 */
export async function readTextFile(filePath: string, opts?: ReadTextFileOptions): Promise<string> {
  const read = fsp.readFile(filePath, 'utf-8');
  if (!opts?.timeoutMs) {
    return read;
  }
  return Promise.race([
    read,
    sleepMs(opts.timeoutMs).then(() => {
      throw new Error('fs-read-timeout');
    }),
  ]);
}

/** 存在则读，不存在返回 `undefined`。 */
export async function readTextFileIfExists(
  filePath: string,
  opts?: ReadTextFileOptions,
): Promise<string | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  return readTextFile(filePath, opts);
}

/** 写入 UTF-8 文本（自动创建父目录）。 */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, content, 'utf-8');
}

/** 追加一行（自动创建父目录）。 */
export async function appendTextLine(filePath: string, line: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fsp.appendFile(filePath, `${line}\n`, 'utf-8');
}

function atomicWriteTmpPath(filePath: string): string {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 原子写：先写临时文件再 rename 覆盖（同 fs 上 rename 原子）。
 */
export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = atomicWriteTmpPath(filePath);
  try {
    await fsp.writeFile(tmpPath, content, 'utf-8');
    await fsp.rename(tmpPath, filePath);
  } catch (e) {
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** 同步原子写（里程碑 / 同步快照等仍走 sync API 的路径）。 */
export function atomicWriteTextFileSync(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = atomicWriteTmpPath(filePath);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* 清理 best-effort */
    }
    throw e;
  }
}

/** 若当前文件 + 即将写入字节数将超过上限，则轮换为 `.1` 备份（best-effort）。 */
export async function rotateFileIfWouldExceed(
  filePath: string,
  incomingBytes: number,
  maxBytes: number,
): Promise<void> {
  if (!(await pathExists(filePath))) {
    return;
  }
  try {
    const size = (await fsp.stat(filePath)).size;
    if (size + incomingBytes > maxBytes) {
      const rotated = `${filePath}.1`;
      await fsp.rm(rotated, { force: true });
      await fsp.rename(filePath, rotated);
    }
  } catch {
    /* 轮换 best-effort */
  }
}

/** 异步退避（用于跨进程锁等待，不阻塞主线程）。 */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
