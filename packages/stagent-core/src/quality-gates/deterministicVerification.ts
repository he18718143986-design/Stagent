import * as fs from 'fs';
import * as path from 'path';

/** B-Q3：验证阶段确定性环境变量（UTC、CI、固定 hash seed）。 */
export function buildDeterministicExecEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    TZ: 'UTC',
    CI: '1',
    PYTHONHASHSEED: '0',
    NODE_ENV: base.NODE_ENV ?? 'test',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };
}

function lockfileExists(cwd: string, name: string): boolean {
  try {
    return fs.existsSync(path.join(cwd, name));
  } catch {
    return false;
  }
}

/**
 * B-Q3：有 lockfile 时将 install 钉为 ci/frozen（降低「同命令不同结果」）。
 * 仅改写独立 install 段，不动 `npm install pkg` 形态。
 */
export function pinInstallCommandForLockfile(command: string, cwd: string): string {
  let out = command;
  if (lockfileExists(cwd, 'package-lock.json')) {
    out = out.replace(/\bnpm\s+install\b(?!\s+[-\w])/g, 'npm ci');
  }
  if (lockfileExists(cwd, 'yarn.lock')) {
    out = out.replace(/\byarn\s+install\b/g, 'yarn install --frozen-lockfile');
  }
  if (lockfileExists(cwd, 'pnpm-lock.yaml')) {
    out = out.replace(/\bpnpm\s+install\b/g, 'pnpm install --frozen-lockfile');
  }
  if (lockfileExists(cwd, 'requirements.txt') && /\bpip3?\s+install\b/.test(out)) {
    out = out.replace(
      /\bpip3?\s+install\b(?!\s+-r)/g,
      'pip install -r requirements.txt',
    );
  }
  return out;
}
