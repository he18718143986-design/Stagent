import type { Stage, WorkflowDefinition } from './WorkflowDefinition';

/** 自动生成文档的产物：文件名（相对 taskDir）+ Markdown 内容。 */
export interface ProcessDoc {
  fileName: string;
  content: string;
}

export const REQUIREMENT_DOC_FILE = '需求分析文档.md';
export const WORKFLOW_PLAN_DOC_FILE = '工作流规划.md';

function trimOrPlaceholder(value: string | undefined, placeholder: string): string {
  const v = (value ?? '').trim();
  return v ? v : placeholder;
}

function toolLabel(tool: Stage['tool']): string {
  switch (tool) {
    case 'llm-text':
      return 'LLM 生成';
    case 'code-runner':
      return '命令执行';
    case 'file-write':
      return '写文件';
    case 'file-read':
      return '读文件';
    case 'user-prompt':
      return '用户输入';
    default:
      return String(tool);
  }
}

function stageOutputFile(stage: Stage): string | undefined {
  if (stage.tool === 'llm-text' && stage.toolConfig.type === 'llm-text') {
    return stage.toolConfig.writeOutputToFile?.trim() || undefined;
  }
  if (stage.tool === 'file-write' && stage.toolConfig.type === 'file-write') {
    return stage.toolConfig.filePath?.trim() || undefined;
  }
  return undefined;
}

/**
 * 「需求分析文档」：记录原始草稿 → 最终确认需求的全过程，写入任务工作目录便于回溯。
 * 原始草稿来自 meta.userInputPolish.originalDraft（仅润色过才有）；最终需求即 meta.userInput。
 */
export function buildRequirementDoc(wf: WorkflowDefinition): ProcessDoc {
  const meta = wf.meta ?? ({} as WorkflowDefinition['meta']);
  const original = meta.userInputPolish?.originalDraft?.trim();
  const finalReq = trimOrPlaceholder(meta.userInput, '（无）');
  const lines: string[] = [];
  lines.push('# 需求分析文档');
  lines.push('');
  lines.push('> 由 Stagent 自动生成，记录本任务从原始需求到最终确认需求的全过程。');
  lines.push('');
  lines.push('## 元信息');
  lines.push('');
  lines.push(`- 任务标题：${trimOrPlaceholder(meta.title, '（未命名）')}`);
  lines.push(`- 任务类型：${trimOrPlaceholder(meta.taskType, '（未知）')}`);
  lines.push(`- 工作目录：${trimOrPlaceholder(meta.taskWorkspacePath, '（默认工作区）')}`);
  lines.push(`- 创建时间：${trimOrPlaceholder(meta.createdAt, new Date().toISOString())}`);
  lines.push('');
  lines.push('## 一、原始需求（用户输入草稿）');
  lines.push('');
  lines.push(original ? original : '（未经过润色，直接使用下方最终需求）');
  lines.push('');
  lines.push('## 二、最终确认需求（润色后）');
  lines.push('');
  lines.push(finalReq);
  lines.push('');
  return { fileName: REQUIREMENT_DOC_FILE, content: lines.join('\n') };
}

/**
 * 「工作流规划」：把工作流阶段排布、所用工具、是否决策/人工审、产物文件、审核重点
 * 渲染为人类可读 Markdown，写入任务工作目录，使整个执行计划可视、可追溯。
 */
export function buildWorkflowPlanDoc(wf: WorkflowDefinition): ProcessDoc {
  const meta = wf.meta ?? ({} as WorkflowDefinition['meta']);
  const stages = wf.stages ?? [];
  const lines: string[] = [];
  lines.push('# 工作流规划');
  lines.push('');
  lines.push('> 由 Stagent 自动生成，记录本任务的阶段排布与执行计划。');
  lines.push('');
  lines.push('## 元信息');
  lines.push('');
  lines.push(`- 任务标题：${trimOrPlaceholder(meta.title, '（未命名）')}`);
  lines.push(`- 任务类型：${trimOrPlaceholder(meta.taskType, '（未知）')}`);
  lines.push(`- 阶段总数：${stages.length}`);
  lines.push('');
  lines.push('## 阶段清单');
  lines.push('');
  stages.forEach((stage, idx) => {
    const tags: string[] = [toolLabel(stage.tool)];
    if (stage.isDecisionStage) {
      tags.push('决策点');
    }
    if (stage.pauseAfter) {
      tags.push('人工审核');
    }
    lines.push(`### ${idx + 1}. ${trimOrPlaceholder(stage.title, stage.id)}　·　${tags.join(' / ')}`);
    lines.push('');
    if (stage.description?.trim()) {
      lines.push(`- 说明：${stage.description.trim()}`);
    }
    const outFile = stageOutputFile(stage);
    if (outFile) {
      lines.push(`- 产物文件：\`${outFile}\``);
    }
    if (stage.aiTip?.trim()) {
      lines.push(`- 审核重点：${stage.aiTip.trim()}`);
    }
    lines.push('');
  });
  return { fileName: WORKFLOW_PLAN_DOC_FILE, content: lines.join('\n') };
}

/** 一次性产出两份过程文档（需求分析文档 + 工作流规划）。 */
export function buildWorkflowProcessDocs(wf: WorkflowDefinition): ProcessDoc[] {
  return [buildRequirementDoc(wf), buildWorkflowPlanDoc(wf)];
}
