import type { WorkflowDefinition } from '../WorkflowDefinition';
import { writeOutputToFileOf } from '../plan-completeness/planCompletenessStageAccess';
import { lintMultiFilePromptMismatch } from '../plan-completeness/multiFileImplChecks';
import { lintTestWriteImportPathsInPlan } from '../plan-completeness/testWriteImportChecks';
import {
  isImplStageId,
  isTestWriteStageId,
  semanticNameFromTestWriteStageId,
} from '../workflow/StageIdPatterns';
import { isLlmTextTool } from '../workflow/StageToolKinds';

const DUAL_PATH_IN_BACKTICKS =
  /`[^`]+\.py`\s*(?:或|和|以及|及|\/)\s*`[^`]+\.py`/g;
const DUAL_PATH_IN_PARENS =
  /（\s*`[^`]+\.py`\s*(?:和|以及|及|或)\s*`[^`]+\.py`\s*）/g;
const BACKTICK_PY_PATH = /`([^`]+\.py)`/gi;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
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
  const baseA = na.split('/').pop() ?? na;
  const baseB = nb.split('/').pop() ?? nb;
  return baseA.length > 0 && baseA === baseB;
}

const PLAIN_PY_PATH = /\b(?:[\w.-]+\/)*[\w.-]+\.py\b/gi;
/** prose：pathA 和 pathB（可选） */
const PROSE_DUAL_PY =
  /\b(?:[\w.-]+\/)*[\w.-]+\.py\s*(?:和|以及|及|或)\s*(?:[\w.-]+\/)*[\w.-]+\.py(?:\s*（可选）)?/gi;

/** impl 阶段：将「path A 或 path B」等多文件暗示收敛为 writeOutputToFile 单一路径（Run #48/#55）。 */
export function repairImplPromptSingleFileTarget(prompt: string, target: string): string {
  let result = prompt.replace(DUAL_PATH_IN_BACKTICKS, `\`${target}\``);
  result = result.replace(DUAL_PATH_IN_PARENS, `（\`${target}\`）`);
  result = result.replace(PROSE_DUAL_PY, target);

  const mentioned = new Set<string>();
  for (const m of result.matchAll(BACKTICK_PY_PATH)) {
    const raw = m[1]?.trim();
    if (raw) {
      mentioned.add(raw);
    }
  }
  let extras = [...mentioned].filter((p) => !pathsReferToSameFile(p, target));
  if (extras.length === 0) {
    // prose 路径（Run #55：main/cli.py 和 main/__init__.py 无反引号）
    result = result.replace(PLAIN_PY_PATH, (match) =>
      pathsReferToSameFile(match, target) ? match : target,
    );
    return result.replace(/\s*（可选）/g, '');
  }
  for (const extra of extras) {
    const escaped = extra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('`' + escaped + '`', 'gi'), `\`${target}\``);
  }
  result = result.replace(PLAIN_PY_PATH, (match) =>
    pathsReferToSameFile(match, target) ? match : target,
  );
  return result.replace(/\s*（可选）/g, '');
}

/** test_write 阶段：将 your_module 占位 import 替换为切片语义模块名（Run #48）。 */
export function repairTestWritePromptImports(prompt: string, semantic: string): string {
  let result = prompt;
  result = result.replace(
    new RegExp(`from\\s+your_module\\.${semantic}\\s+import`, 'gi'),
    `from ${semantic} import`,
  );
  result = result.replace(/from\s+your_module\s+import/gi, `from ${semantic} import`);
  result = result.replace(new RegExp(`your_module\\.${semantic}`, 'gi'), semantic);
  return result;
}

function shouldSkipImplSanitize(stageId: string): boolean {
  return stageId.includes('_stagent_bundle') || stageId === 'stage_impl_conftest';
}

/**
 * 语义填充后确定性修补：消除 multi-file-prompt-mismatch 与 test-write-import-not-in-plan。
 * 在 compilePlan lint 之前调用，避免 generate 方差早败。
 */
export function sanitizeSemanticFillWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const stages = (workflow.stages ?? []).map((stage) => {
    if (!isLlmTextTool(stage.tool) || stage.toolConfig.type !== 'llm-text') {
      return stage;
    }
    let prompt = stage.toolConfig.systemPrompt ?? '';
    let changed = false;

    if (isImplStageId(stage.id) && !shouldSkipImplSanitize(stage.id)) {
      const target = writeOutputToFileOf(stage)?.trim();
      if (target) {
        const repaired = repairImplPromptSingleFileTarget(prompt, target);
        if (repaired !== prompt) {
          prompt = repaired;
          changed = true;
        }
      }
    }

    if (isTestWriteStageId(stage.id)) {
      const semantic = semanticNameFromTestWriteStageId(stage.id);
      if (semantic) {
        const repaired = repairTestWritePromptImports(prompt, semantic);
        if (repaired !== prompt) {
          prompt = repaired;
          changed = true;
        }
      }
    }

    if (!changed) {
      return stage;
    }
    return {
      ...stage,
      toolConfig: {
        ...stage.toolConfig,
        systemPrompt: prompt,
      },
    };
  });
  return { ...workflow, stages };
}

/** 是否仍存在语义填充类 plan completeness 问题（供单测断言）。 */
export function hasSemanticFillPlanIssues(workflow: WorkflowDefinition): boolean {
  for (const stage of workflow.stages ?? []) {
    if (lintMultiFilePromptMismatch(stage)) {
      return true;
    }
  }
  return lintTestWriteImportPathsInPlan(workflow).some(
    (i) => i.type === 'test-write-import-not-in-plan',
  );
}
