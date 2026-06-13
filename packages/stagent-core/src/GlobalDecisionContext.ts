import type { GlobalDecisionInjectMode, InputSource, Stage, StageRuntime, WorkflowDefinition } from './WorkflowDefinition';

export const STAGENT_GLOBAL_DECISIONS_LABEL = '_stagent_approved_decisions';

/** 单条 decisionRecord 在 summary 模式下的默认截断长度（字符） */
export const GLOBAL_DECISION_SUMMARY_MAX_CHARS_PER_RECORD = 1200;

export type { GlobalDecisionInjectMode };

export interface ApprovedDecisionSnippet {
  stageId: string;
  title: string;
  record: string;
}

/** workflow 级显式覆盖 vscode 默认；undefined 表示沿用 vscode 设置 */
function resolveInjectApprovedDecisionContext(
  workflowFlag: boolean | undefined,
  vscodeDefault: boolean,
): boolean {
  return workflowFlag ?? vscodeDefault;
}

export function resolveGlobalDecisionInjectMode(
  workflowMode: GlobalDecisionInjectMode | undefined,
  vscodeMode: GlobalDecisionInjectMode,
): GlobalDecisionInjectMode {
  return workflowMode ?? vscodeMode;
}

export function shouldInjectGlobalDecisionContext(
  stage: Stage,
  workflowFlag: boolean | undefined,
  vscodeDefault: boolean,
): boolean {
  if (!resolveInjectApprovedDecisionContext(workflowFlag, vscodeDefault)) {
    return false;
  }
  if (stage.isDecisionStage === true) {
    return false;
  }
  if (stage.tool !== 'llm-text') {
    return false;
  }
  return true;
}

/** 已在 input.sources 显式引用的 decisionRecord，不再重复注入 */
export function decisionStageIdsAlreadyInSources(sources: InputSource[]): Set<string> {
  const ids = new Set<string>();
  for (const s of sources) {
    if (s.type === 'stage-output' && s.outputKey === 'decisionRecord' && s.stageId?.trim()) {
      ids.add(s.stageId.trim());
    }
  }
  return ids;
}

/**
 * 收集除当前阶段外、已 done 且含决策正文的全部决策阶段（按 stages[] 顺序）。
 * 不依赖数组下标，避免 DAG 调度时漏掉已批准决策。
 */
export function collectApprovedDecisionSnippets(
  definition: WorkflowDefinition,
  runtimes: StageRuntime[],
  currentStageId: string,
): ApprovedDecisionSnippet[] {
  const out: ApprovedDecisionSnippet[] = [];
  for (let i = 0; i < definition.stages.length; i++) {
    const stage = definition.stages[i];
    if (stage.id === currentStageId || stage.isDecisionStage !== true) {
      continue;
    }
    const rt = runtimes[i];
    if (rt.status !== 'done') {
      continue;
    }
    const record = String(rt.approvedDecisionRecord ?? rt.outputs.decisionRecord ?? '').trim();
    if (!record) {
      continue;
    }
    out.push({ stageId: stage.id, title: stage.title, record });
  }
  return out;
}

export function filterSnippetsNotAlreadySourced(
  snippets: ApprovedDecisionSnippet[],
  sources: InputSource[],
): ApprovedDecisionSnippet[] {
  const already = decisionStageIdsAlreadyInSources(sources);
  return snippets.filter((s) => !already.has(s.stageId));
}

export function summarizeDecisionRecord(
  record: string,
  maxChars = GLOBAL_DECISION_SUMMARY_MAX_CHARS_PER_RECORD,
): string {
  const trimmed = record.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}\n\n…（本决策正文已截断；实现须与已批准 DecisionRecord 一致）`;
}

export function formatGlobalDecisionContextBlock(
  snippets: ApprovedDecisionSnippet[],
  mode: GlobalDecisionInjectMode = 'summary',
): string {
  if (snippets.length === 0) {
    return '';
  }
  const heading =
    mode === 'summary'
      ? '## 已批准的全局决策摘要（Stagent 自动注入）'
      : '## 已批准的全局决策上下文（Stagent 自动注入）';
  const parts = snippets.map((s) => {
    const body = mode === 'summary' ? summarizeDecisionRecord(s.record) : s.record;
    return `### [${s.stageId}] ${s.title}\n\n${body}`;
  });
  return `${heading}\n\n${parts.join('\n\n---\n\n')}`;
}

/** 拼入 llm-text 的 systemPrompt 末尾（不修改 stage 定义 JSON） */
export function appendGlobalDecisionContextToSystemPrompt(
  systemPrompt: string,
  block: string | null | undefined,
): string {
  if (!block?.trim()) {
    return systemPrompt;
  }
  return `${systemPrompt.trimEnd()}\n\n---\n\n${block.trim()}`;
}

export interface BuildGlobalDecisionBlockOptions {
  workflowInjectFlag?: boolean;
  vscodeInjectEnabled: boolean;
  mode: GlobalDecisionInjectMode;
}

/** 纯函数：判断是否注入并生成 systemPrompt 追加块 */
export function buildGlobalDecisionSystemPromptBlock(
  definition: WorkflowDefinition,
  runtimes: StageRuntime[],
  stage: Stage,
  options: BuildGlobalDecisionBlockOptions,
): string | null {
  if (!shouldInjectGlobalDecisionContext(stage, options.workflowInjectFlag, options.vscodeInjectEnabled)) {
    return null;
  }
  const snippets = filterSnippetsNotAlreadySourced(
    collectApprovedDecisionSnippets(definition, runtimes, stage.id),
    stage.input.sources,
  );
  const block = formatGlobalDecisionContextBlock(snippets, options.mode);
  return block || null;
}
