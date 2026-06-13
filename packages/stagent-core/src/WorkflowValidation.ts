import type { CodeRunnerConfig, FileReadConfig, FileWriteConfig, WorkflowDefinition } from './WorkflowDefinition';
import { formatWorkflowDependencyCycleError } from './WorkflowDag';
import { collectAllCodeRunnerLintIssues, formatCodeRunnerCommandIssue } from './CodeRunnerCommandLint';

export function validateGeneratedWorkflow(wf: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (wf.version !== '2.0') {
    errors.push(`WorkflowDefinition.version 必须为 '2.0'，当前为 ${JSON.stringify(wf.version)}`);
  }
  if (!wf.stages?.length) {
    errors.push('stages 不能为空');
  }
  const stageOrder = new Map((wf.stages ?? []).map((s, i) => [s.id, i]));
  const stages = wf.stages ?? [];
  const KNOWN_TOOLS = new Set(['llm-text', 'code-runner', 'file-read', 'file-write']);
  for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    // 生成被截断时，尾部阶段常只剩 id/title/description 而缺 tool/toolConfig。
    // 显式校验 tool，给出可操作提示（建议重新生成），而非让下游因缺字段崩溃。
    if (!stage.tool || !KNOWN_TOOLS.has(stage.tool)) {
      errors.push(
        `阶段 ${stage.id} 缺少有效的 tool 字段（当前为 ${JSON.stringify(
          stage.tool,
        )}）：生成可能被截断，请重新生成工作流`,
      );
      continue;
    }
    if (stage.isDecisionStage && stage.tool !== 'llm-text') {
      errors.push(`不变式 I-1：阶段 ${stage.id} 为决策阶段但 tool 不是 llm-text`);
    }
    if (stage.isDecisionStage && stage.exposeAssumptions) {
      errors.push(`不变式 I-5：阶段 ${stage.id} isDecisionStage 与 exposeAssumptions 不能同时为 true`);
    }
    if (stage.questionAfter?.length && !stage.pauseAfter) {
      errors.push(`不变式 I-6：阶段 ${stage.id} 含 questionAfter 时 pauseAfter 必须为 true`);
    }
    if (stage.tool === 'file-read') {
      const cfg = stage.toolConfig as Partial<FileReadConfig>;
      if (!cfg.filePath || !String(cfg.filePath).trim()) {
        errors.push(`工具配置错误：阶段 ${stage.id} (file-read) 缺少 filePath`);
      }
    }
    if (stage.tool === 'file-write') {
      const cfg = stage.toolConfig as Partial<FileWriteConfig>;
      if (!cfg.filePath || !String(cfg.filePath).trim()) {
        errors.push(`工具配置错误：阶段 ${stage.id} (file-write) 缺少 filePath`);
      }
      if (!cfg.sourceOutputKey || !String(cfg.sourceOutputKey).trim()) {
        errors.push(`工具配置错误：阶段 ${stage.id} (file-write) 缺少 sourceOutputKey`);
      }
      if (cfg.sourceStageId?.trim() && !wf.stages.some((s) => s.id === cfg.sourceStageId)) {
        errors.push(`工具配置错误：阶段 ${stage.id} (file-write) sourceStageId 引用未知阶段: ${cfg.sourceStageId}`);
      }
    }
    if (stage.tool === 'code-runner') {
      const cfg = stage.toolConfig as Partial<CodeRunnerConfig>;
      if (!cfg.command || !String(cfg.command).trim()) {
        errors.push(`工具配置错误：阶段 ${stage.id} (code-runner) 缺少 command`);
      } else {
        for (const issue of collectAllCodeRunnerLintIssues(String(cfg.command), wf, si)) {
          errors.push(formatCodeRunnerCommandIssue(stage.id, issue));
        }
      }
    }
    /** Web / uni-app 脚手架固定 id：与决策阶段 decisionRecord 语义隔离，避免调试日志 / bundle 误用 key */
    if (stage.id === 'stage_impl_web_package_json' || stage.id === 'stage_impl_uniapp_package_json') {
      if (stage.isDecisionStage === true) {
        errors.push(
          `阶段 ${stage.id} 为实现阶段（生成 package.json），不得设置 isDecisionStage=true（否则 UI 会误用 approveDecision，日志 outputKey 易与决策混淆）`,
        );
      }
      const firstKey = stage.outputs?.[0]?.key;
      if (firstKey !== 'packageJson') {
        errors.push(
          `阶段 ${stage.id} 的首个 outputs[].key 必须为 "packageJson"（当前为 ${JSON.stringify(
            firstKey,
          )}）；禁止沿用决策阶段的 decisionRecord`,
        );
      }
    }
    const deps = stage.dependsOn;
    if (deps?.length) {
      const selfIdx = stageOrder.get(stage.id) ?? -1;
      for (const depId of deps) {
        if (!depId?.trim()) {
          errors.push(`阶段 ${stage.id} dependsOn 含空 id`);
          continue;
        }
        const depIdx = stageOrder.get(depId);
        if (depIdx === undefined) {
          errors.push(`阶段 ${stage.id} dependsOn 引用未知阶段: ${depId}`);
        } else if (depIdx >= selfIdx) {
          errors.push(`阶段 ${stage.id} dependsOn 中「${depId}」须出现在 stages[] 中本阶段之前`);
        }
      }
    }
  }

  const cycleErr = formatWorkflowDependencyCycleError(wf.stages ?? []);
  if (cycleErr) {
    errors.push(cycleErr);
  }

  return errors;
}
