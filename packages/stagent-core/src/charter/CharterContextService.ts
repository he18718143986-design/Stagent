import type { WorkspaceConfiguration } from '../platform/HostTypes';
import {
  readCharterEnabled,
  readCharterRelativePath,
} from '../settings/readers/charter';
import {
  appendCharterConstraintsToSystemPrompt,
  buildCharterConstraintsBlock,
} from './CharterConstraintsBlock';
import type { CharterDocument } from './CharterTypes';
import { loadCharterFromWorkspaceSync } from './CharterLoader';

const cache = new Map<string, CharterDocument | null>();

export function clearCharterCache(): void {
  cache.clear();
}

function cacheKey(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot}::${relativePath}`;
}

export function loadCharterForWorkspace(
  workspaceRoot: string | undefined,
  cfg?: WorkspaceConfiguration,
): CharterDocument | null {
  if (!workspaceRoot || !readCharterEnabled(cfg)) {
    return null;
  }
  const rel = readCharterRelativePath(cfg);
  const key = cacheKey(workspaceRoot, rel);
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }
  const doc = loadCharterFromWorkspaceSync(workspaceRoot, rel);
  cache.set(key, doc);
  return doc;
}

export function augmentSystemPromptWithCharterConstraints(
  systemPrompt: string,
  workspaceRoot: string | undefined,
  cfg?: WorkspaceConfiguration,
): { prompt: string; block: string | null } {
  const doc = loadCharterForWorkspace(workspaceRoot, cfg);
  const block = buildCharterConstraintsBlock(doc);
  return {
    prompt: appendCharterConstraintsToSystemPrompt(systemPrompt, block),
    block,
  };
}
