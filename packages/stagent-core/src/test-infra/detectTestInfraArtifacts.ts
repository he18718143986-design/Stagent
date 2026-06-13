import * as fs from 'fs';
import {
  BABEL_CONFIG_BASENAME,
  JEST_CONFIG_BASENAME,
  TSCONFIG_BASENAME,
} from './constants';
import type { TestInfraArtifacts } from './artifacts';
import { emptyTestInfraArtifacts } from './artifacts';

/** 根据单个 basename 更新 jest/babel/tsconfig 标志（保留已为 true 的项）。 */
export function applyTestInfraBasename(
  acc: TestInfraArtifacts,
  basename: string,
): TestInfraArtifacts {
  return {
    jest: acc.jest || JEST_CONFIG_BASENAME.test(basename),
    babel: acc.babel || BABEL_CONFIG_BASENAME.test(basename),
    tsconfig: acc.tsconfig || TSCONFIG_BASENAME.test(basename),
  };
}

/** 扫描目录 readdir 结果 → test-infra artifacts。 */
export function detectTestInfraArtifactsFromDir(dir: string): TestInfraArtifacts {
  let acc = emptyTestInfraArtifacts();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    acc = applyTestInfraBasename(acc, name);
  }
  return acc;
}
