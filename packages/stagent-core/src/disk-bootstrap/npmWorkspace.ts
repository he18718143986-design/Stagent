import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteTextFileSync } from '../FsAsync';
import { WORKSPACE_PACKAGE_JSON } from '../workspace/WorkspaceRootFilenames';

/**
 * `npm init -y` 默认写入的 `scripts.test` 会故意 exit 1，导致后续 `stage_test_run_*` 误失败。
 */
export function patchNpmDefaultTestScriptAfterInit(workspaceRoot: string): boolean {
  const pkgPath = path.join(workspaceRoot, WORKSPACE_PACKAGE_JSON);
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf-8');
  } catch {
    return false;
  }
  let j: { scripts?: Record<string, string> };
  try {
    j = JSON.parse(raw) as { scripts?: Record<string, string> };
  } catch {
    return false;
  }
  const t = j.scripts?.test;
  if (typeof t !== 'string' || !t.includes('no test specified')) {
    return false;
  }
  j.scripts = j.scripts ?? {};
  j.scripts.test = 'node -e "process.exit(0)"';
  atomicWriteTextFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n');
  return true;
}
