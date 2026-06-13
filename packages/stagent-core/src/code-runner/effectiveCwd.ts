/**
 * code-runner 有效 cwd SSOT：合并 pathBase/workingDir 与命令首部 `cd <dir>`。
 * 预检（M38.1）、执行（M41）、auto-deps 共用。
 */
import * as path from 'path';
import type { CodeRunnerConfig } from '../WorkflowDefinition';
import type { CodeRunnerHostDeps } from '../WorkflowCodeRunnerHost';
import { resolveCodeRunnerCwd } from '../WorkflowCodeRunnerHost';
import { parseTestRunWorkingDir } from '../structural-repair/helpers';
import { safeJoinUnderWorkspaceRoot } from '../WorkflowPathResolver';

export function resolveBaseCodeRunnerCwd(
  deps: CodeRunnerHostDeps,
  cfg: CodeRunnerConfig,
  instanceKey: string,
): string {
  return resolveCodeRunnerCwd(deps, cfg, instanceKey);
}

/** 将 base cwd 与 command 内 `cd <dir>` 对齐为实际执行/扫描目录。 */
export function resolveEffectiveCodeRunnerCwd(params: {
  workspaceRoot: string;
  baseCwd: string;
  command: string;
}): string {
  const cdRel = parseTestRunWorkingDir(params.command);
  if (cdRel === undefined) {
    return params.baseCwd;
  }
  const root = path.resolve(params.workspaceRoot);
  if (cdRel === '') {
    return root;
  }
  try {
    return safeJoinUnderWorkspaceRoot(root, cdRel);
  } catch {
    return params.baseCwd;
  }
}

const CD_SEGMENT = /^cd\s+/i;

function splitCommandSegments(command: string): string[] {
  return command
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isCdSegment(segment: string): boolean {
  return CD_SEGMENT.test(segment);
}

/** 剥离命令首部连续 `cd … &&` 段；无剩余段时返回 shell 空操作 `:`。 */
export function stripLeadingCdSegments(command: string): string {
  const segments = splitCommandSegments(command);
  if (segments.length === 0) {
    return command;
  }
  let i = 0;
  while (i < segments.length && isCdSegment(segments[i]!)) {
    i += 1;
  }
  if (i === 0) {
    return command;
  }
  if (i >= segments.length) {
    return ':';
  }
  return segments.slice(i).join(' && ');
}

export function resolveCodeRunnerExecutionContext(
  deps: CodeRunnerHostDeps,
  cfg: CodeRunnerConfig,
  instanceKey: string,
): { baseCwd: string; effectiveCwd: string; command: string } {
  const baseCwd = resolveBaseCodeRunnerCwd(deps, cfg, instanceKey);
  const workspaceRoot = deps.getWorkspaceRootAbsolute() ?? baseCwd;
  const effectiveCwd = resolveEffectiveCodeRunnerCwd({
    workspaceRoot,
    baseCwd,
    command: cfg.command,
  });
  const command = stripLeadingCdSegments(cfg.command);
  return { baseCwd, effectiveCwd, command };
}
