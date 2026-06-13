import type { StageRuntime } from '../WorkflowDefinition';
import { GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID } from '../workflow/StageIdPatterns';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { isDecisionArtifactsV1 } from './decisionArtifactsSchema';

/** 从全局架构决策 artifacts 解析将落盘的 config.yaml 正文（SSOT）。 */
export function resolveArchitectureConfigYamlContent(
  stageRuntimes: readonly StageRuntime[],
): string | undefined {
  const archRt = stageRuntimes.find((r) => r.stageId === GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID);
  if (!archRt) {
    return undefined;
  }
  const direct = archRt.outputs.configContent;
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }
  const raw = archRt.outputs[DECISION_ARTIFACTS_OUTPUT_KEY];
  if (!isDecisionArtifactsV1(raw) || !raw.files?.length) {
    return undefined;
  }
  const file =
    raw.files.find((f) => f.key === 'configContent') ??
    raw.files.find((f) => /\.ya?ml$/i.test(f.path ?? ''));
  const content = file?.content;
  return typeof content === 'string' && content.trim() ? content : undefined;
}

export function isPythonEntryScriptPath(relPath: string | undefined): boolean {
  if (!relPath?.trim()) {
    return false;
  }
  return /(^|\/)(main|server|app|manage)\.py$/i.test(relPath.replace(/\\/g, '/'));
}
