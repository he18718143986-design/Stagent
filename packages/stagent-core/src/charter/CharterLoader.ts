import * as fs from 'fs';
import * as path from 'path';
import type { CharterDocument } from './CharterTypes';
import { parseCharterMarkdown } from './CharterParser';

export const DEFAULT_CHARTER_RELATIVE_PATH = 'docs/agents/charter.md';

export function resolveCharterAbsolutePath(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, relativePath);
}

export function loadCharterFromWorkspaceSync(
  workspaceRoot: string,
  relativePath = DEFAULT_CHARTER_RELATIVE_PATH,
): CharterDocument | null {
  const abs = resolveCharterAbsolutePath(workspaceRoot, relativePath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    return parseCharterMarkdown(abs, raw);
  } catch {
    return null;
  }
}
