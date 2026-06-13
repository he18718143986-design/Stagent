import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';

export interface SpawnWithTimeoutOptions {
  cwd: string;
  shell?: boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  onStdoutChunk?: (text: string) => void;
  onStderrChunk?: (text: string) => void;
}

export interface SpawnWithTimeoutResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export function spawnShellWithTimeout(
  command: string,
  opts: SpawnWithTimeoutOptions,
): Promise<SpawnWithTimeoutResult> {
  const child = spawn(command, {
    cwd: opts.cwd,
    shell: opts.shell ?? true,
    env: opts.env,
  });
  return collectChildWithTimeout(child, opts);
}

/**
 * 以 argv 数组直接执行(shell:false),用于需要精确传参、避免 shell 转义的场景
 * (如 `sandbox-exec -p <profile> /bin/sh -c <command>`)。
 */
export function spawnArgvWithTimeout(
  file: string,
  args: string[],
  opts: SpawnWithTimeoutOptions,
): Promise<SpawnWithTimeoutResult> {
  const child = spawn(file, args, {
    cwd: opts.cwd,
    shell: false,
    env: opts.env,
  });
  return collectChildWithTimeout(child, opts);
}

// ─── 有界运行（B-Q1）：后台起长驻进程 → 探活/grace → 进程组 kill ──────────
// 解决「长驻进程（npm start / node server.js）永不退出 → spawnShellWithTimeout
// 永不 resolve → 执行器卡到 timeout」。用于 smoke/e2e：起服务、确认就绪、立即收掉。

export interface BoundedServeOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** 探活命令（shell）；exit 0 视为就绪。未提供则改用 graceMs「存活探测」。 */
  readyProbe?: string;
  /** 探活轮询上限（ms）；超时即判失败。默认 30000。 */
  readyTimeoutMs?: number;
  /** 探活轮询间隔（ms）。默认 1000。 */
  probeIntervalMs?: number;
  /** 无 readyProbe 时：进程需稳定存活这么久才算通过（ms）。默认 4000。 */
  graceMs?: number;
  onStdoutChunk?: (text: string) => void;
  onStderrChunk?: (text: string) => void;
}

export interface BoundedServeResult {
  /** 探活成功 或 grace 内持续存活。 */
  ready: boolean;
  /** 进程在就绪前自行退出（启动失败 / 立即崩溃）。 */
  crashed: boolean;
  /** 进程退出码（若在判定前已退出）。 */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** 探活轮询超时（进程仍在跑但始终未就绪）。 */
  timedOut: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 杀掉子进程及其整个进程组/树（detached 时子进程是组长）。best-effort。 */
function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      return;
    }
    // POSIX：detached 子进程自成进程组，负 pid 杀整组。
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* 已退出 */
        }
      }
    }, 1500);
  } catch {
    /* 已退出 */
  }
}

/**
 * 有界运行长驻命令：后台启动 → 探活（readyProbe）或存活（graceMs）→ 收掉进程树。
 * 与 spawnShellWithTimeout 的区别：不等待进程自行退出（长驻进程不会退出），
 * 而是「确认就绪即成功收尾」，从根本上避免卡住执行器。
 */
export async function spawnBoundedServe(
  command: string,
  opts: BoundedServeOptions,
): Promise<BoundedServeResult> {
  const readyTimeoutMs = opts.readyTimeoutMs ?? 30_000;
  const probeIntervalMs = opts.probeIntervalMs ?? 1_000;
  const graceMs = opts.graceMs ?? 4_000;

  const child = spawn(command, {
    cwd: opts.cwd,
    env: opts.env,
    shell: true,
    detached: process.platform !== 'win32',
  });

  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode: number | null = null;

  child.stdout.on('data', (buf: Buffer) => {
    const text = buf.toString();
    stdout += text;
    opts.onStdoutChunk?.(text);
  });
  child.stderr.on('data', (buf: Buffer) => {
    const text = buf.toString();
    stderr += text;
    opts.onStderrChunk?.(text);
  });
  child.on('exit', (code) => {
    exited = true;
    exitCode = typeof code === 'number' ? code : null;
  });

  const finish = (r: Omit<BoundedServeResult, 'stdout' | 'stderr'>): BoundedServeResult => {
    if (!exited) {
      killProcessTree(child);
    }
    return { ...r, stdout, stderr };
  };

  if (opts.readyProbe && opts.readyProbe.trim()) {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) {
        return finish({ ready: false, crashed: true, exitCode, timedOut: false });
      }
      const probe = spawnSync(opts.readyProbe, {
        cwd: opts.cwd,
        env: opts.env,
        shell: true,
        timeout: Math.max(1_000, probeIntervalMs),
      });
      if (probe.status === 0) {
        return finish({ ready: true, crashed: false, exitCode: null, timedOut: false });
      }
      await sleep(probeIntervalMs);
    }
    return finish({ ready: false, crashed: false, exitCode, timedOut: true });
  }

  // 无探活命令：存活探测——进程在 graceMs 内不自行退出即视为「起得来」。
  await sleep(graceMs);
  if (exited) {
    return finish({ ready: false, crashed: true, exitCode, timedOut: false });
  }
  return finish({ ready: true, crashed: false, exitCode: null, timedOut: false });
}

function collectChildWithTimeout(
  child: ChildProcessWithoutNullStreams,
  opts: SpawnWithTimeoutOptions,
): Promise<SpawnWithTimeoutResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stdout += text;
      opts.onStdoutChunk?.(text);
    });
    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      opts.onStderrChunk?.(text);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        timedOut,
        signal: signal ?? null,
      });
    });
  });
}
