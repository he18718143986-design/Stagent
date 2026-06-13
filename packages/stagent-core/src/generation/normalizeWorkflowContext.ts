import * as fs from 'fs';
import {
  isImproveArchitectureTaskType,
  isRefactorTaskType,
  isSoftwareTaskType,
} from '../workflow/TaskType';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { contextMdPath } from '../paths/StagentPaths';
import { isFileReadTool } from '../workflow/StageToolKinds';
import { STAGE_ID_ZOOM_OUT } from '../workflow/StageIdPatterns';
import { resolveWorkspaceRootAbsolute } from '../WorkflowPathResolver';

export function shouldUpgradeZoomOutStage(
  wf: WorkflowDefinition,
  taskType: string,
): boolean {
  return (
    (isImproveArchitectureTaskType(taskType) ||
      isRefactorTaskType(taskType) ||
      (isSoftwareTaskType(taskType) && wf.meta?.isGreenfield !== true)) &&
    (wf.stages ?? []).some((s) => s.id === STAGE_ID_ZOOM_OUT && isFileReadTool(s.tool))
  );
}

/** best-effort 读取 .stagent/CONTEXT.md 供 zoom-out 升级。 */
export function readZoomOutGlossaryHint(
  wf: WorkflowDefinition,
  glossaryEnabled: boolean,
  onDegraded?: (reason: string, context?: Record<string, unknown>) => void,
): string | undefined {
  if (!glossaryEnabled) {
    return undefined;
  }
  const wr = resolveWorkspaceRootAbsolute(wf.meta?.taskWorkspacePath);
  if (!wr) {
    return undefined;
  }
  try {
    const ctxPath = contextMdPath(wr);
    if (fs.existsSync(ctxPath)) {
      return fs.readFileSync(ctxPath, 'utf-8');
    }
  } catch (e) {
    // CONTEXT.md 存在却读取失败属异常：结构化告警后降级（zoom-out 不附 glossary），行为不变。
    onDegraded?.('zoom_out_glossary_read_failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
  return undefined;
}
