import {
  detectMultiModuleLayout,
  extractPathLikeTokens,
} from '../path-router/multiModuleLayoutDetect';
import { T4_DEFAULT_SLICE_MODULES } from './constants';

const SLICE_NAME_DENYLIST = new Set([
  'config',
  'tests',
  'test',
  'src',
  'docs',
  'deliver',
  'delivery',
  'cli',
  'venv',
  'requirements',
  'mock',
  'csv',
]);

function canonicalizeT4DefaultModules(
  ordered: string[],
  userInput: string,
  taskType: string,
): string[] {
  if (!detectMultiModuleLayout({ taskType, userInput })) {
    return ordered;
  }
  const defaultSet = new Set<string>(T4_DEFAULT_SLICE_MODULES);
  const hit = ordered.filter((m) => defaultSet.has(m)).length;
  if (hit >= 4) {
    return [...T4_DEFAULT_SLICE_MODULES];
  }
  return ordered;
}

function sanitizeSemantic(raw: string): string | undefined {
  const name = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.py$/i, '')
    ?.replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
  if (!name || name.length < 2 || SLICE_NAME_DENYLIST.has(name)) {
    return undefined;
  }
  if (name.startsWith('test_')) {
    return undefined;
  }
  return name;
}

/**
 * 从需求文本提取 Python 绿场垂直切片模块语义（indicators / signals / …）。
 * multiModuleLayout 命中但 token 不足时回退 T4 默认五模块。
 */
export function extractPythonSliceModules(userInput: string, taskType = 'software'): string[] {
  const modules = new Set<string>();
  for (const token of extractPathLikeTokens(userInput)) {
    if (token.endsWith('/')) {
      const semantic = sanitizeSemantic(token.slice(0, -1));
      if (semantic) {
        modules.add(semantic);
      }
      continue;
    }
    if (/\.py$/i.test(token)) {
      const semantic = sanitizeSemantic(token);
      if (semantic) {
        modules.add(semantic);
      }
    }
  }

  const ordered = [...modules];
  if (ordered.length >= 4) {
    return canonicalizeT4DefaultModules(ordered.slice(0, 8), userInput, taskType);
  }

  if (detectMultiModuleLayout({ taskType, userInput })) {
    return [...T4_DEFAULT_SLICE_MODULES];
  }

  return ordered;
}
