import * as fs from 'fs';
import * as path from 'path';

import type { TaskBrief } from './TaskBriefTypes';

export const DEFAULT_TASK_BRIEF_RELATIVE_PATH = '.stagent/task-brief.json';

/**
 * Tolerant parse of a raw value into a TaskBrief, mirroring the style of
 * `parseDefinitionOfDone`. Returns null when the input cannot represent a valid
 * brief (non-object, array, or missing/empty `goal`).
 */
export function parseTaskBrief(raw: unknown): TaskBrief | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.goal !== 'string') {
    return null;
  }
  const goal = o.goal.trim();
  if (goal.length === 0) {
    return null;
  }

  return {
    goal,
    nonGoals: toStringList(o.nonGoals),
    boundaries: toStringList(o.boundaries),
    acceptance: toStringList(o.acceptance),
  };
}

/**
 * Reads `.stagent/task-brief.json` from the workspace root. Returns null when the
 * file does not exist or cannot be parsed.
 */
export function readTaskBriefFromWorkspace(workspaceRoot: string): TaskBrief | null {
  const abs = path.join(workspaceRoot, DEFAULT_TASK_BRIEF_RELATIVE_PATH);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown;
    return parseTaskBrief(parsed);
  } catch {
    return null;
  }
}

/**
 * Normalizes a raw value into a trimmed, non-empty string list. Accepts a single
 * string (→ `[trimmed]`) or a string array (trim + drop empties). Anything else
 * → `[]`.
 */
function toStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}
