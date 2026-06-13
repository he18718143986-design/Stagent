import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { getStagentConfiguration } from '../getStagentConfiguration';

export function readConfigBoolean(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
  defaultValue: boolean,
): boolean {
  try {
    const c = getStagentConfiguration(cfg);
    const v = c.get<boolean>(key);
    if (v === undefined) {
      return defaultValue;
    }
    return v;
  } catch {
    return defaultValue;
  }
}

/** Treat unset as true; only explicit `false` is false (vscode `!== false` pattern). */
export function readConfigBooleanDefaultTrue(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
): boolean {
  try {
    const c = getStagentConfiguration(cfg);
    return c.get<boolean>(key) !== false;
  } catch {
    return true;
  }
}

/** Treat unset as false; only explicit `true` is true (vscode `=== true` pattern). */
export function readConfigBooleanStrictTrue(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
): boolean {
  return readConfigBoolean(cfg, key, false) === true;
}

export function readConfigStringEnum<T extends string>(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  try {
    const c = getStagentConfiguration(cfg);
    const raw = c.get<string>(key);
    if (raw !== undefined && (allowed as readonly string[]).includes(raw)) {
      return raw as T;
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export type TriStateLintMode = 'off' | 'warn' | 'hard';

export function readTriStateLintMode(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
  defaultValue: TriStateLintMode = 'warn',
): TriStateLintMode {
  return readConfigStringEnum(cfg, key, ['off', 'warn', 'hard'] as const, defaultValue);
}

export function readConfigRaw(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
): unknown {
  try {
    const c = getStagentConfiguration(cfg);
    return c.get(key);
  } catch {
    return undefined;
  }
}

export function readConfigResolved<T>(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
  resolve: (raw: unknown) => T,
  fallback: T,
): T {
  try {
    const c = getStagentConfiguration(cfg);
    return resolve(c.get(key));
  } catch {
    return fallback;
  }
}
