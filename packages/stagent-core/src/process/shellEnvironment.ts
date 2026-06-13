import { spawnSync } from 'child_process';

const CAPTURE_TIMEOUT_MS = 15_000;

let cachedLoginEnv: NodeJS.ProcessEnv | undefined;
let cacheShell: string | undefined;

/** 测试用：清空登录 shell 环境缓存。 */
export function resetShellEnvironmentCache(): void {
  cachedLoginEnv = undefined;
  cacheShell = undefined;
}

export function defaultLoginShell(shellOverride?: string): string {
  if (shellOverride?.trim()) {
    return shellOverride.trim();
  }
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/** 解析 `env` / `set` 标准输出中的 KEY=value 行。 */
export function parseEnvStdout(stdout: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    env[key] = line.slice(eq + 1);
  }
  return env;
}

/**
 * 通过登录 + 交互 shell 采集用户环境（与 VS Code 集成终端更接近）。
 * macOS 上 nvm/fnm/Homebrew 多在 .zshrc，需 `-i` 才会加载。
 */
export function captureLoginShellEnvSync(shellOverride?: string): NodeJS.ProcessEnv {
  const shell = defaultLoginShell(shellOverride);
  if (cachedLoginEnv && cacheShell === shell) {
    return cachedLoginEnv;
  }

  let parsed: NodeJS.ProcessEnv = {};
  try {
    if (process.platform === 'win32') {
      const result = spawnSync(shell, ['/c', 'set'], {
        encoding: 'utf8',
        timeout: CAPTURE_TIMEOUT_MS,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        parsed = parseEnvStdout(result.stdout);
      }
    } else {
      const result = spawnSync(shell, ['-ilc', 'env'], {
        encoding: 'utf8',
        timeout: CAPTURE_TIMEOUT_MS,
        env: { ...process.env, TERM: 'dumb' },
      });
      if (result.status === 0 && result.stdout) {
        parsed = parseEnvStdout(result.stdout);
      }
    }
  } catch {
    parsed = {};
  }

  cachedLoginEnv = parsed;
  cacheShell = shell;
  return parsed;
}

/**
 * 合并 Extension Host 环境与登录 shell 环境；登录 shell 的 PATH 优先。
 */
export function getMergedExecEnv(shellOverride?: string): NodeJS.ProcessEnv {
  const login = captureLoginShellEnvSync(shellOverride);
  const merged: NodeJS.ProcessEnv = { ...process.env, ...login };
  if (login.PATH) {
    merged.PATH = login.PATH;
  }
  return merged;
}
