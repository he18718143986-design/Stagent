import * as path from 'path';
import type { Artifact, ArtifactState } from './ArtifactLifecycleManager';
import type { Stage, ToolPathBase, WorkflowGlobalConfig } from './WorkflowDefinition';

export interface StageArtifactHint {
  filePath: string;
  state?: ArtifactState;
  canDiff: boolean;
}

export interface DownstreamResetPanelInput {
  resetStageTitles: string[];
  rolledBackFiles?: string[];
  rollbackFailed?: Array<{ filePath: string; error: string }>;
}

/** 确认页只读展示 globalConfig 关键项（M19.3） */
export function formatGlobalConfigSummaryForConfirm(
  globalConfig: WorkflowGlobalConfig | undefined,
): string[] {
  const gc = globalConfig ?? {};
  const lines: string[] = ['—— 全局配置 ——'];
  lines.push(`DAG 调度：${gc.enableDagScheduler === true ? '开启' : '关闭（线性）'}`);
  if (gc.dagMaxParallelism !== undefined) {
    lines.push(`DAG 并行度：${gc.dagMaxParallelism}`);
  }
  const inject =
    gc.injectApprovedDecisionContext === true
      ? '开启'
      : gc.injectApprovedDecisionContext === false
        ? '关闭'
        : '（跟随 VS Code 设置）';
  lines.push(`决策上下文注入：${inject}`);
  if (gc.globalDecisionInjectMode) {
    lines.push(`决策注入模式：${gc.globalDecisionInjectMode}`);
  }
  lines.push(
    `决策内容 HARD 校验：${
      gc.enableDecisionContentLint === false
        ? '关闭'
        : gc.enableDecisionContentLint === true
          ? '开启'
          : '开启（默认）'
    }`,
  );
  if (gc.language) {
    lines.push(`语言：${gc.language}`);
  }
  if (gc.modelOverrides) {
    const parts: string[] = [];
    if (gc.modelOverrides.decisionStage) {
      parts.push(`决策=${gc.modelOverrides.decisionStage}`);
    }
    if (gc.modelOverrides.implStage) {
      parts.push(`实现=${gc.modelOverrides.implStage}`);
    }
    if (gc.modelOverrides.lightweightStage) {
      parts.push(`轻量=${gc.modelOverrides.lightweightStage}`);
    }
    if (parts.length) {
      lines.push(`模型覆盖：${parts.join('；')}`);
    }
  }
  return lines;
}

function listStageOutputFilePaths(
  stage: Stage,
): Array<{ relativePath: string; pathBase?: ToolPathBase }> {
  const out: Array<{ relativePath: string; pathBase?: ToolPathBase }> = [];
  if (stage.tool === 'llm-text' && stage.toolConfig.type === 'llm-text' && stage.toolConfig.writeOutputToFile) {
    out.push({
      relativePath: stage.toolConfig.writeOutputToFile,
      pathBase: stage.toolConfig.writePathBase,
    });
  }
  if (stage.tool === 'file-write' && stage.toolConfig.type === 'file-write') {
    out.push({
      relativePath: stage.toolConfig.filePath,
      pathBase: stage.toolConfig.pathBase,
    });
  }
  return out;
}

function basenameMatches(a: string, b: string): boolean {
  return path.basename(a) === path.basename(b) || a.endsWith(b) || b.endsWith(a);
}

/** 从 registry + stage 配置汇总暂停栏工件提示（M19.2 / M19.4） */
export function collectStageArtifactHints(
  registry: Artifact[] | undefined,
  stage: Stage,
): StageArtifactHint[] {
  const hints: StageArtifactHint[] = [];
  const seen = new Set<string>();

  if (registry) {
    for (const art of registry) {
      if (art.stageId !== stage.id) {
        continue;
      }
      if (art.state === 'rolled-back' || art.state === 'superseded') {
        continue;
      }
      const key = path.normalize(art.filePath);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      hints.push({
        filePath: art.filePath,
        state: art.state,
        canDiff: !!(art.existedBefore && art.priorContent !== undefined),
      });
    }
  }

  for (const p of listStageOutputFilePaths(stage)) {
    const rel = p.relativePath;
    if (hints.some((h) => basenameMatches(h.filePath, rel))) {
      continue;
    }
    hints.push({ filePath: rel, canDiff: false });
  }

  return hints;
}

export function findStageArtifact(
  registry: Artifact[] | undefined,
  stageId: string,
  filePath: string,
): Artifact | undefined {
  if (!registry?.length) {
    return undefined;
  }
  const normHint = path.normalize(filePath);
  return [...registry]
    .reverse()
    .find(
      (a) =>
        a.stageId === stageId &&
        a.state !== 'rolled-back' &&
        a.state !== 'superseded' &&
        (path.normalize(a.filePath) === normHint || basenameMatches(a.filePath, filePath)),
    );
}

export function resolveStageArtifactAbsPath(
  stage: Stage,
  filePath: string,
  registry: Artifact[] | undefined,
  resolveOutputPath: (relativePath: string, base?: ToolPathBase) => string,
): string {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  const art = findStageArtifact(registry, stage.id, filePath);
  if (art) {
    return art.filePath;
  }
  const paths = listStageOutputFilePaths(stage);
  const match =
    paths.find((p) => p.relativePath === filePath || basenameMatches(p.relativePath, filePath)) ??
    paths[0];
  if (match) {
    return resolveOutputPath(match.relativePath, match.pathBase ?? 'instance');
  }
  return resolveOutputPath(filePath, 'instance');
}

/** downstreamReset 内联面板文案行（M19.1 · 便于单测） */
export function formatDownstreamResetPanelLines(input: DownstreamResetPanelInput): string[] {
  const lines: string[] = [];
  lines.push('已重置下游阶段：');
  for (const t of input.resetStageTitles) {
    lines.push(`· ${t}`);
  }
  if (input.rolledBackFiles?.length) {
    lines.push('');
    lines.push('已回滚文件：');
    for (const f of input.rolledBackFiles) {
      lines.push(`· ${f}`);
    }
  }
  if (input.rollbackFailed?.length) {
    lines.push('');
    lines.push('回滚失败：');
    for (const f of input.rollbackFailed) {
      lines.push(`· ${f.filePath}: ${f.error}`);
    }
  }
  return lines;
}
