import type { WorkflowExperience } from './WorkflowExperienceStore';

const ARTIFACT_ALIGNMENT_HINT =
  'test_run 的 python -c 仅 import writeOutputToFile 已登记的 .py；仅有 config.yaml 时禁止 from config import，改用 yaml.safe_load 或增加 config.py 阶段。';

/** M20.4：从失败经验构建 generator few-shot（不含 userInput 原文） */
function buildFailureExperienceFewShotForGenerator(
  experiences: WorkflowExperience[],
  options?: { maxEntries?: number; taskType?: string },
): string {
  const maxEntries = options?.maxEntries ?? 2;
  let pool = experiences.filter(
    (e) =>
      e.completionStatus === 'failed' &&
      e.failureErrorType === 'tool-execution-failed' &&
      /^stage_test_run_/.test(e.failureStageId ?? ''),
  );
  if (options?.taskType) {
    pool = pool.filter((e) => e.taskType === options.taskType);
  }
  const picked = pool.slice(-maxEntries);
  if (picked.length === 0) {
    return '';
  }
  const lines: string[] = [
    '【历史 test_run 失败摘要（避免重复 artifact/import 不一致；勿复制 stage id）】',
    `- 修复要点：${ARTIFACT_ALIGNMENT_HINT}`,
  ];
  for (const exp of picked) {
    lines.push(
      `- failedAt=${exp.failureStageId ?? '?'} taskType=${exp.taskType ?? '?'} error=${exp.failureErrorType ?? '?'}`,
    );
  }
  return lines.join('\n');
}

/** M17.6 + M20.4：从经验库构建 generator few-shot 块（不含 userInput 原文）。 */
export function buildExperienceFewShotForGenerator(
  experiences: WorkflowExperience[],
  options?: { maxEntries?: number; taskType?: string; includeFailures?: boolean },
): string {
  const maxEntries = options?.maxEntries ?? 3;
  let pool = experiences.filter((e) => e.completionStatus === 'completed');
  if (options?.taskType) {
    pool = pool.filter((e) => e.taskType === options.taskType);
  }
  const picked = pool.slice(-maxEntries);
  const failureBlock =
    options?.includeFailures !== false
      ? buildFailureExperienceFewShotForGenerator(experiences, {
          maxEntries: 2,
          taskType: options?.taskType,
        })
      : '';

  if (picked.length === 0 && !failureBlock) {
    return '';
  }

  const lines: string[] = [];
  if (picked.length > 0) {
    lines.push(
      '【历史成功工作流摘要（few-shot，勿复制 stage id  verbatim；不得改写决策阶段合同 prompt）】',
    );
    for (const exp of picked) {
      const outcomes = (exp.stageOutcomes ?? [])
        .filter((o) => o.finalStatus === 'done')
        .slice(0, 8)
        .map((o) => o.stageId)
        .join(', ');
      lines.push(
        `- taskType=${exp.taskType ?? '?'} stages=${exp.stageCount ?? '?'} humanInterventions=${exp.humanInterventions ?? 0} done=[${outcomes}]`,
      );
    }
  }
  if (failureBlock) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(failureBlock);
  }
  return lines.join('\n');
}
