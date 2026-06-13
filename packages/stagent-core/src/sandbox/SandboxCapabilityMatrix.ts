import { accessSync, constants } from 'node:fs';

/** 内核级隔离方式；与平台能力矩阵一致。 */
export type SandboxIsolationKind = 'kernel-sandbox-exec' | 'soft-constraints-only' | 'none';

export interface SandboxCapabilityRow {
  isolation: SandboxIsolationKind;
  /** 该平台在工具可用时是否视为 enforced（fail-closed 基准）。 */
  enforcedWhenAvailable: boolean;
  notes: string;
}

/**
 * 各平台 code-runner 沙箱能力矩阵（文档 SSOT）。
 *
 * | 平台   | 内核隔离          | sandboxEnforced | 说明 |
 * |--------|-------------------|-----------------|------|
 * | darwin | sandbox-exec      | true（若可执行） | 写隔离 + 可选断网 |
 * | darwin | 无 sandbox-exec   | false           | ENOENT → fail-closed（启用时） |
 * | linux  | 无（ulimit+代理） | false           | 软约束，非安全边界 |
 * | win32  | 无                | false           | 软约束，非安全边界 |
 */
export const SANDBOX_CAPABILITY_MATRIX: Readonly<
  Partial<Record<NodeJS.Platform, SandboxCapabilityRow>>
> = {
  darwin: {
    isolation: 'kernel-sandbox-exec',
    enforcedWhenAvailable: true,
    notes:
      'macOS sandbox-exec：写仅限工作目录与临时目录，networkAllowed=false 时 deny network*。',
  },
  linux: {
    isolation: 'soft-constraints-only',
    enforcedWhenAvailable: false,
    notes:
      '仅 ulimit 与 *_PROXY 环境变量软网络阻断，子进程可绕过；启用 sandbox.enabled 时 fail-closed。',
  },
  win32: {
    isolation: 'soft-constraints-only',
    enforcedWhenAvailable: false,
    notes: '无内核级隔离；启用 sandbox.enabled 时 fail-closed。',
  },
};

export interface SandboxCapabilityState {
  platform: NodeJS.Platform;
  /** 当前进程是否具备可依赖的内核级沙箱隔离。 */
  sandboxEnforced: boolean;
  isolation: SandboxIsolationKind;
  detail: string;
}

const LINUX_FALLBACK: SandboxCapabilityRow = SANDBOX_CAPABILITY_MATRIX.linux!;

/** darwin 上探测 sandbox-exec 是否可执行（ENOENT 则 false）。 */
export function isSandboxExecOnPath(): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }
  const candidates = ['/usr/bin/sandbox-exec', '/bin/sandbox-exec'];
  return candidates.some((p) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** 解析当前运行时的沙箱 enforced 能力（供启用设置与 fail-closed 决策）。 */
export function resolveSandboxCapability(): SandboxCapabilityState {
  const platform = process.platform;
  const row = SANDBOX_CAPABILITY_MATRIX[platform] ?? LINUX_FALLBACK;

  if (platform === 'darwin') {
    if (isSandboxExecOnPath()) {
      return {
        platform,
        sandboxEnforced: true,
        isolation: 'kernel-sandbox-exec',
        detail: row.notes,
      };
    }
    return {
      platform,
      sandboxEnforced: false,
      isolation: 'soft-constraints-only',
      detail: 'sandbox-exec 不可用（ENOENT 或不可执行）；无法提供内核级隔离。',
    };
  }

  return {
    platform,
    sandboxEnforced: false,
    isolation: row.isolation,
    detail: row.notes,
  };
}

export class SandboxEnforcementUnavailableError extends Error {
  constructor(readonly capability: SandboxCapabilityState) {
    super(
      `sandbox.enabled 已开启但当前环境无内核级隔离（${capability.platform}）：${capability.detail}`,
    );
    this.name = 'SandboxEnforcementUnavailableError';
  }
}

/** sandbox.enabled 时 fail-closed：无 enforced 能力则拒绝执行。 */
export function assertSandboxEnforcementAvailable(): void {
  const capability = resolveSandboxCapability();
  if (!capability.sandboxEnforced) {
    throw new SandboxEnforcementUnavailableError(capability);
  }
}
