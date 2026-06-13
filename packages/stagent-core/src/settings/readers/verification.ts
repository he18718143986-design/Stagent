import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { readAfkEnabled } from './afk';

const DEFAULT_FLAKY_RERUN_COUNT = 1;
const AFK_FLAKY_RERUN_COUNT = 3;

/** vscode `stagent.verification.flakyRerunCount`；验证阶段总运行次数（≥1）。AFK 默认 3。 */
export function readVerificationFlakyRerunCount(cfg?: WorkspaceConfiguration): number {
  const raw = cfg?.get<number>('verification.flakyRerunCount');
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  if (readAfkEnabled(cfg)) {
    return AFK_FLAKY_RERUN_COUNT;
  }
  return DEFAULT_FLAKY_RERUN_COUNT;
}

/** vscode `stagent.verification.deterministic`；验证阶段钉版本/环境，默认 true。 */
export function readVerificationDeterministic(cfg?: WorkspaceConfiguration): boolean {
  const raw = cfg?.get<boolean>('verification.deterministic');
  if (typeof raw === 'boolean') {
    return raw;
  }
  return true;
}
