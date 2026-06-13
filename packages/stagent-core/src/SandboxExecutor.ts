import { spawn } from 'child_process';

export interface SandboxOptions {
  memoryLimitMb?: number;
  timeoutSeconds?: number;
  networkAllowed: boolean;
  writeablePathGlobs?: string[];
  env?: Record<string, string>;
  requireEnforced?: boolean;
  onStdoutChunk?: (text: string) => void;
  onStderrChunk?: (text: string) => void;
  onDegraded?: (message: string) => void;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  memoryExceeded: boolean;
  blockedNetworkAttempts: number;
}

export class SandboxExecutionError extends Error {
  constructor(
    message: string,
    readonly errorType: 'sandbox-network-blocked' | 'sandbox-memory-exceeded' | 'code-runner-timeout',
  ) {
    super(message);
    this.name = 'SandboxExecutionError';
  }
}

const DEFAULT_MEMORY_MB = 512;
const DEFAULT_TIMEOUT_SEC = 60;

function buildSandboxEnv(options: SandboxOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (!options.networkAllowed) {
    env.HTTP_PROXY = 'http://127.0.0.1:9';
    env.HTTPS_PROXY = 'http://127.0.0.1:9';
    env.NO_PROXY = 'localhost,127.0.0.1';
    env.STAGENT_SANDBOX_NETWORK = 'blocked';
  }
  return env;
}

function memoryLimitPrefix(memoryLimitMb: number): string {
  if (process.platform === 'win32') {
    return '';
  }
  const kb = Math.max(1, memoryLimitMb) * 1024;
  return `ulimit -v ${kb} 2>/dev/null; `;
}

/**
 * 实验性 code-runner 沙箱包装；默认关闭，由 `stagent.sandbox.enabled` 控制。
 * 网络：`networkAllowed` 由调用方按命令解析（`CodeRunnerInvokeHelpers.resolveSandboxNetworkAllowed`：
 * npm/pip 等安装命令自动放行）。
 */
export async function runInSandbox(
  command: string,
  cwd: string,
  options: SandboxOptions,
): Promise<SandboxResult> {
  const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const memoryMb = options.memoryLimitMb ?? DEFAULT_MEMORY_MB;
  const wrapped = `${memoryLimitPrefix(memoryMb)}${command}`;

  return new Promise((resolve, reject) => {
    const child = spawn(wrapped, {
      cwd,
      shell: true,
      env: buildSandboxEnv(options),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stdout += text;
      options.onStdoutChunk?.(text);
    });
    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      options.onStderrChunk?.(text);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const memoryExceeded =
        !timedOut &&
        (signal === 'SIGKILL' || /Cannot allocate memory|ENOMEM|Killed/i.test(stderr));
      if (timedOut) {
        reject(new SandboxExecutionError('sandbox execution timed out', 'code-runner-timeout'));
        return;
      }
      if (memoryExceeded) {
        reject(new SandboxExecutionError('sandbox memory limit exceeded', 'sandbox-memory-exceeded'));
        return;
      }
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        timedOut: false,
        memoryExceeded: false,
        blockedNetworkAttempts: options.networkAllowed ? 0 : countNetworkAttempts(stderr),
      });
    });
  });
}

function countNetworkAttempts(stderr: string): number {
  const hints = [/ECONNREFUSED/i, /network.*blocked/i, /getaddrinfo ENOTFOUND/i];
  return hints.reduce((n, re) => n + (re.test(stderr) ? 1 : 0), 0);
}

export function mapSandboxError(error: unknown): 'sandbox-network-blocked' | 'sandbox-memory-exceeded' | 'code-runner-timeout' | undefined {
  if (error instanceof SandboxExecutionError) {
    return error.errorType;
  }
  if (error instanceof Error && error.message.includes('code-runner-timeout')) {
    return 'code-runner-timeout';
  }
  return undefined;
}
