import * as fs from 'fs';
import * as path from 'path';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { codeRunnerCommandOf, writeOutputToFileOf } from '../workflow/StageToolConfigAccess';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import { EXPO_ENTRY_BASENAME, EXPO_STACK_HINT } from './constants';
import { relPathBasename } from './basename';
import { WORKSPACE_PACKAGE_JSON } from '../workspace/WorkspaceRootFilenames';

function readPackageJson(dir: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null {
  const pkgPath = path.join(dir, WORKSPACE_PACKAGE_JSON);
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    return JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function dirHasExpoEntry(dir: string): boolean {
  try {
    const names = fs.readdirSync(dir);
    return names.some((n) => EXPO_ENTRY_BASENAME.test(n));
  } catch {
    return false;
  }
}

/** 生成期：从 workflow stages 推断 Expo/RN 栈。 */
export function planSignalsExpoStack(wf: WorkflowDefinition): boolean {
  return (wf.stages ?? []).some((s) => {
    const file = writeOutputToFileOf(s);
    if (file) {
      const base = relPathBasename(file.replace(/\\/g, '/'));
      if (EXPO_ENTRY_BASENAME.test(base)) {
        return true;
      }
      if (EXPO_STACK_HINT.test(file)) {
        return true;
      }
    }
    if (EXPO_STACK_HINT.test(s.id) || EXPO_STACK_HINT.test(s.title ?? '')) {
      return true;
    }
    if (isCodeRunnerTool(s.tool) && EXPO_STACK_HINT.test(codeRunnerCommandOf(s))) {
      return true;
    }
    return false;
  });
}

/** 运行期：磁盘 + 可选 stage 命令上的 Expo/RN 栈信号。 */
export function diskSignalsExpoStack(workspaceRoot: string, cwd: string, stage?: Stage): boolean {
  const roots = [...new Set([cwd, workspaceRoot].filter(Boolean))];
  for (const root of roots) {
    if (dirHasExpoEntry(root)) {
      return true;
    }
    const mobile = path.join(root, 'mobile');
    if (dirHasExpoEntry(mobile)) {
      return true;
    }
    const pkg = readPackageJson(root);
    if (pkg) {
      const blob = JSON.stringify(pkg.dependencies ?? {}) + JSON.stringify(pkg.devDependencies ?? {});
      if (EXPO_STACK_HINT.test(blob)) {
        return true;
      }
    }
  }
  if (stage) {
    const cmd = codeRunnerCommandOf(stage);
    if (EXPO_STACK_HINT.test(cmd) || EXPO_STACK_HINT.test(stage.id)) {
      return true;
    }
  }
  return false;
}
