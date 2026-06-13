import { isLlmTextTool } from '../workflow/StageToolKinds';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import type { PlanCompletenessIssue } from '../plan-completeness/planCompletenessTypes';
import { findFileWriteSourceRuntime } from '../non-llm-runners/helpers';
import type { WorkflowInstance } from '../WorkflowDefinition';
import {
  DECISION_ARTIFACTS_OUTPUT_KEY,
  PRIMARY_DECISION_OUTPUT_KEY,
} from '../WorkflowOutputKeys';

function declaredOutputKeys(stage: Stage): Set<string> {
  return new Set((stage.outputs ?? []).map((o) => o.key).filter(Boolean));
}

function resolveUpstreamStage(
  wf: WorkflowDefinition,
  fileWriteStage: Stage,
): Stage | undefined {
  const cfg = fileWriteStage.toolConfig;
  if (cfg.type !== 'file-write') {
    return undefined;
  }
  const sourceStageId = cfg.sourceStageId?.trim();
  if (sourceStageId) {
    return wf.stages?.find((s) => s.id === sourceStageId);
  }
  const key = cfg.sourceOutputKey?.trim();
  if (!key) {
    return undefined;
  }
  return wf.stages?.find((s) => declaredOutputKeys(s).has(key));
}

/**
 * 生成期 artifact graph：file-write 的 sourceOutputKey 须在上游 outputs 声明中可达。
 */
export function lintArtifactGraph(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of wf.stages ?? []) {
    if (stage.tool !== 'file-write' || stage.toolConfig.type !== 'file-write') {
      continue;
    }
    const cfg = stage.toolConfig;
    const key = cfg.sourceOutputKey?.trim();
    if (!key) {
      issues.push({
        type: 'artifact-graph-unresolved-key',
        message: `阶段 ${stage.id} (file-write) 缺少 sourceOutputKey`,
      });
      continue;
    }
    const upstream = resolveUpstreamStage(wf, stage);
    if (!upstream) {
      issues.push({
        type: 'artifact-graph-unresolved-key',
        message: `阶段 ${stage.id} file-write 无法解析上游阶段（sourceKey=${key}）`,
      });
      continue;
    }
    const keys = declaredOutputKeys(upstream);
    const sidecarVirtualKey =
      upstream.isDecisionStage &&
      keys.has(DECISION_ARTIFACTS_OUTPUT_KEY) &&
      key !== PRIMARY_DECISION_OUTPUT_KEY &&
      key !== DECISION_ARTIFACTS_OUTPUT_KEY;
    if (!keys.has(key) && !sidecarVirtualKey) {
      issues.push({
        type: 'artifact-graph-unresolved-key',
        message: `阶段 ${stage.id} 引用 ${upstream.id}.outputs.${key}，但该阶段 outputs 未声明此 key（artifact-graph-unresolved-key:${key}）`,
      });
    }
  }
  for (const stage of wf.stages ?? []) {
    if (!isLlmTextTool(stage.tool)) {
      continue;
    }
    const tc = stage.toolConfig;
    if (tc.type !== 'llm-text') {
      continue;
    }
    const prompt = tc.systemPrompt ?? '';
    if (!prompt.trim() && !stage.isDecisionStage) {
      issues.push({
        type: 'thin-llm-system-prompt',
        message: `阶段 ${stage.id} 缺少 systemPrompt（建议生成期补齐，执行期将使用运行时后缀）`,
      });
    }
  }
  return issues;
}

/** 仅 hard block 类 artifact 问题（thin prompt 为 warn，不阻断）。 */
export function lintArtifactGraphHard(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  return lintArtifactGraph(wf).filter((i) => i.type === 'artifact-graph-unresolved-key');
}

/** 执行期兜底：file-write 上游 runtime 是否有非空内容。 */
export function runtimeArtifactGraphIssue(
  instance: WorkflowInstance,
  stage: Stage,
): string | undefined {
  if (stage.tool !== 'file-write' || stage.toolConfig.type !== 'file-write') {
    return undefined;
  }
  const cfg = stage.toolConfig;
  const sourceRt = findFileWriteSourceRuntime(instance, cfg);
  if (!sourceRt) {
    return `file-write source output not found: key=${cfg.sourceOutputKey}`;
  }
  const content = String(sourceRt.outputs[cfg.sourceOutputKey] ?? '');
  if (!content.trim()) {
    return `file-write empty content: stage=${stage.id} sourceKey=${cfg.sourceOutputKey} target=${cfg.filePath}`;
  }
  return undefined;
}
