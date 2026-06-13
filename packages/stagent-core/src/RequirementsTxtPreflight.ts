import * as fs from 'fs';
import * as path from 'path';
import {
  lintRequirementsTxtContent,
  normalizeRequirementsTxtContent,
} from './RequirementsTxtNormalize';
import type { CodeRunnerConfig } from './WorkflowDefinition';
import { isCodeRunnerTool } from './workflow/StageToolKinds';

export function commandInstallsRequirementsTxt(command: string): boolean {
  return /\bpip3?\s+install\b/.test(command) && /\brequirements\.txt\b/.test(command);
}

export function stageInstallsRequirementsTxt(stage: {
  tool: string;
  toolConfig: unknown;
}): boolean {
  if (!isCodeRunnerTool(stage.tool)) {
    return false;
  }
  const cmd = (stage.toolConfig as CodeRunnerConfig).command ?? '';
  return commandInstallsRequirementsTxt(cmd);
}

/**
 * pip install -r 前：读盘校验 requirements.txt，必要时自动修正幻觉版本钉。
 * 返回 block 消息；若已自动写回修正则 fixes 非空。
 */
export function lintAndMaybeFixRequirementsTxtOnDisk(cwd: string): {
  blocked: boolean;
  messages: string[];
  fixes: Array<{ line: number; before: string; after: string }>;
} {
  const abs = path.join(cwd, 'requirements.txt');
  if (!fs.existsSync(abs)) {
    return { blocked: false, messages: [], fixes: [] };
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const issues = lintRequirementsTxtContent(raw);
  if (issues.length === 0) {
    return { blocked: false, messages: [], fixes: [] };
  }
  const { content, fixes } = normalizeRequirementsTxtContent(raw);
  if (fixes.length > 0) {
    fs.writeFileSync(abs, content, 'utf8');
    const remaining = lintRequirementsTxtContent(content);
    if (remaining.length === 0) {
      return { blocked: false, messages: [], fixes };
    }
  }
  return {
    blocked: true,
    messages: issues.map((i) => i.message),
    fixes,
  };
}

/** pip install -r 前：requirements.txt 必须已落盘（E9 运行时兜底）。 */
export function preflightRequirementsTxtForPipInstall(cwd: string): {
  blocked: boolean;
  messages: string[];
  fixes: Array<{ line: number; before: string; after: string }>;
} {
  const abs = path.join(cwd, 'requirements.txt');
  if (!fs.existsSync(abs)) {
    return {
      blocked: true,
      messages: [
        'requirements.txt 尚未落盘：pip install -r 须在写入 requirements.txt 的阶段之后执行',
      ],
      fixes: [],
    };
  }
  return lintAndMaybeFixRequirementsTxtOnDisk(cwd);
}
