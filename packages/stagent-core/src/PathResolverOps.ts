import * as fs from 'fs';
import * as path from 'path';
import type { ToolPathBase } from './WorkflowDefinition';
import {
  getReadableProjectRoots,
  pickZoomOutFilePath,
  resolveWorkspaceRootAbsolute,
  safeJoinUnderWorkspaceRoot,
} from './WorkflowPathResolver';
import { resolveFirstExistingReadablePath } from './workflow/resolveReadablePath';
import type { PathHostDeps } from './PathHostDeps';

export function createPathResolverOps(deps: PathHostDeps) {
  function ensureTaskDir(instanceKey: string): string {
    const inst = deps.getInstance();
    if (!inst) {
      return deps.getDefaultTaskDir(instanceKey);
    }
    if (!inst.taskDir) {
      inst.taskDir = deps.getDefaultTaskDir(instanceKey);
    }
    fs.mkdirSync(inst.taskDir, { recursive: true });
    return inst.taskDir;
  }

  function resolveTaskFilePath(instanceKey: string, filePath: string): string {
    return path.join(ensureTaskDir(instanceKey), filePath);
  }

  function getWorkspaceRootAbsolute(): string | undefined {
    const inst = deps.getInstance();
    return resolveWorkspaceRootAbsolute(inst?.definition?.meta?.taskWorkspacePath, inst?.taskDir);
  }

  function safeJoin(root: string, relativePath: string): string {
    return safeJoinUnderWorkspaceRoot(root, relativePath);
  }

  function resolveOutputPath(
    instanceKey: string,
    filePath: string,
    base: ToolPathBase = 'instance',
  ): string {
    if (base === 'workspace') {
      const wr = getWorkspaceRootAbsolute();
      if (!wr) {
        deps.warn('file-write/code-runner pathBase=workspace 但缺少 meta.taskWorkspacePath，回退到 instance 根');
        return resolveTaskFilePath(instanceKey, filePath);
      }
      return safeJoin(wr, filePath);
    }
    return resolveTaskFilePath(instanceKey, filePath);
  }

  function resolveReadableFilePath(instanceKey: string, filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    const roots = getReadableProjectRoots(deps.getVscodeWorkspaceFolder());
    return resolveFirstExistingReadablePath({
      relativePath: filePath,
      searchRoots: roots,
      fallbackAbsolute: resolveTaskFilePath(instanceKey, filePath),
    });
  }

  function pickZoomOut(preferred?: string): string {
    return pickZoomOutFilePath(getReadableProjectRoots(deps.getVscodeWorkspaceFolder()), preferred);
  }

  return {
    ensureTaskDir,
    resolveTaskFilePath,
    getWorkspaceRootAbsolute,
    safeJoinUnderWorkspaceRoot: safeJoin,
    resolveOutputPath,
    resolveReadableFilePath,
    pickZoomOutFilePath: pickZoomOut,
    getReadableProjectRoots: () => getReadableProjectRoots(deps.getVscodeWorkspaceFolder()),
  };
}

export type PathResolverOps = ReturnType<typeof createPathResolverOps>;
