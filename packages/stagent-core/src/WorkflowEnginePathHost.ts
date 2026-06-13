/**
 * M41：引擎路径解析 + patch 落盘 — 从 WorkflowEngine 抽出实例/工作区路径与 applyPatchInstructions。
 */
import { createPatchApplyOps } from './PatchApplyOps';
import { createPathResolverOps } from './PathResolverOps';
import type { PathHostDeps } from './PathHostDeps';

export type { PathHostDeps };

export function createPathHost(deps: PathHostDeps) {
  const resolver = createPathResolverOps(deps);
  const patch = createPatchApplyOps(deps, resolver);
  return {
    ...resolver,
    applyPatchInstructions: patch.applyPatchInstructions,
  };
}

export type WorkflowEnginePathHost = ReturnType<typeof createPathHost>;
