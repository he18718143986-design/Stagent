import { planCompletenessMsg } from '../l10n/lintMsg';
import { isImplStageId } from '../workflow/StageIdPatterns';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { writeOutputToFileOf } from './planCompletenessStageAccess';
import type { Stage } from '../WorkflowDefinition';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

/** 常见落盘路径（含 Dockerfile 无扩展名）。 */
const OUTPUT_PATH_PATTERN =
  /(?:[\w.-]+\/)*[\w.-]+(?:\.(?:ts|tsx|js|jsx|json|ya?ml|py|dart|toml|xml|gradle|properties|md|sh|dockerfile)|\/dockerfile|dockerfile)/gi;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function basenameOf(p: string): string {
  const n = normalizePath(p);
  const parts = n.split('/');
  return parts[parts.length - 1] ?? n;
}

function mentionedOutputPaths(prompt: string): string[] {
  const found = new Set<string>();
  for (const m of prompt.matchAll(OUTPUT_PATH_PATTERN)) {
    const raw = m[0]?.trim();
    if (!raw) {
      continue;
    }
    found.add(normalizePath(raw));
  }
  return [...found];
}

function pathsReferToSameFile(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (na === nb) {
    return true;
  }
  if (na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`)) {
    return true;
  }
  return basenameOf(na) === basenameOf(nb) && basenameOf(na).length > 0;
}

function promptHintsMultipleArtifacts(prompt: string, target: string): boolean {
  const lower = prompt.toLowerCase();
  const targetNorm = normalizePath(target);

  const multiFileCue =
    /(?:生成|编写|输出|创建).{0,24}(?:和|以及|及|与|both|and).{0,48}(?:dockerfile|docker-compose|\.ya?ml|\.json|\.ts|\.tsx)/i.test(
      prompt,
    );

  const mentionsCompose =
    /docker-compose\.ya?ml/i.test(prompt) && !targetNorm.includes('docker-compose');
  const mentionsDockerfile =
    /\bdockerfile\b/i.test(prompt) &&
    !targetNorm.includes('dockerfile') &&
    basenameOf(targetNorm) !== 'dockerfile';

  return multiFileCue || mentionsCompose || mentionsDockerfile;
}

export function lintMultiFilePromptMismatch(stage: Stage): PlanCompletenessIssue | null {
  if (!isImplStageId(stage.id) || !isLlmTextTool(stage.tool)) {
    return null;
  }
  const target = writeOutputToFileOf(stage)?.trim();
  if (!target) {
    return null;
  }

  const prompt = (stage.toolConfig as { systemPrompt?: string }).systemPrompt ?? '';
  const mentioned = mentionedOutputPaths(prompt);
  const distinctOthers = mentioned.filter((p) => !pathsReferToSameFile(p, target));

  const multiHint = promptHintsMultipleArtifacts(prompt, target);
  if (distinctOthers.length === 0 && !multiHint) {
    return null;
  }

  if (distinctOthers.length === 1 && !multiHint) {
    // 单条路径引用可能是示例/注释，不阻断
    return null;
  }

  const extras = distinctOthers.length > 0 ? distinctOthers.join(', ') : '(prompt 暗示多文件)';
  return {
    type: 'multi-file-prompt-mismatch',
    message: planCompletenessMsg('multi-file-prompt-mismatch', target, extras),
  };
}

export function lintWorkflowMultiFilePromptMismatches(stages: Stage[]): PlanCompletenessIssue[] {
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of stages) {
    const issue = lintMultiFilePromptMismatch(stage);
    if (issue) {
      issues.push(issue);
    }
  }
  return issues;
}
