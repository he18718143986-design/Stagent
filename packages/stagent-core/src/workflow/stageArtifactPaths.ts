/** Stage artifact relative paths (llm-text / file-write / file-read); no Node deps — safe for webview bundle. */

import {
  isFileReadTool,
  isFileWriteTool,
  isLlmTextTool,
} from './StageToolKinds';

export interface StageArtifactPathSource {
  tool: string;
  toolConfig?: {
    type?: string;
    writeOutputToFile?: string;
    filePath?: string;
    writePathBase?: 'instance' | 'workspace';
    pathBase?: 'instance' | 'workspace';
  };
}

export interface StageArtifactPathEntry {
  relativePath: string;
  pathBase?: 'instance' | 'workspace';
}

export function normalizeArtifactRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function getStageArtifactPath(stage: StageArtifactPathSource): string | undefined {
  const tc = stage.toolConfig;
  if (!tc) {
    return undefined;
  }
  if (isLlmTextTool(stage.tool) && typeof tc.writeOutputToFile === 'string' && tc.writeOutputToFile.trim()) {
    return normalizeArtifactRelativePath(tc.writeOutputToFile);
  }
  if (
    (isFileWriteTool(stage.tool) || isFileReadTool(stage.tool)) &&
    typeof tc.filePath === 'string' &&
    tc.filePath.trim()
  ) {
    return normalizeArtifactRelativePath(tc.filePath);
  }
  return undefined;
}

/** Typed llm-text / file-write paths with optional pathBase (confirm / pause-bar UI). */
export function listStageArtifactPathEntries(stage: StageArtifactPathSource): StageArtifactPathEntry[] {
  const out: StageArtifactPathEntry[] = [];
  const tc = stage.toolConfig;
  if (!tc) {
    return out;
  }
  if (
    isLlmTextTool(stage.tool) &&
    tc.type === 'llm-text' &&
    typeof tc.writeOutputToFile === 'string' &&
    tc.writeOutputToFile.trim()
  ) {
    out.push({
      relativePath: normalizeArtifactRelativePath(tc.writeOutputToFile),
      pathBase: tc.writePathBase,
    });
  }
  if (
    isFileWriteTool(stage.tool) &&
    tc.type === 'file-write' &&
    typeof tc.filePath === 'string' &&
    tc.filePath.trim()
  ) {
    out.push({
      relativePath: normalizeArtifactRelativePath(tc.filePath),
      pathBase: tc.pathBase,
    });
  }
  return out;
}

export function collectArtifactPathsFromStages(stages: StageArtifactPathSource[]): string[] {
  const pathSet = new Set<string>();
  for (const s of stages) {
    const p = getStageArtifactPath(s);
    if (p) {
      pathSet.add(p);
    }
  }
  return [...pathSet].sort();
}
