import {
  BABEL_CONFIG_BASENAME,
  JEST_CONFIG_BASENAME,
  TSCONFIG_BASENAME,
} from './constants';

export function relPathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').trim();
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function isTestInfraConfigBasename(base: string): boolean {
  return (
    JEST_CONFIG_BASENAME.test(base) ||
    BABEL_CONFIG_BASENAME.test(base) ||
    TSCONFIG_BASENAME.test(base)
  );
}
