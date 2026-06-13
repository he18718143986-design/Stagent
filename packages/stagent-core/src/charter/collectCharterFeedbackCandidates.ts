import type { CharterRuleType, DecisionProvenance } from './CharterTypes';
import type { CharterDocument } from './CharterTypes';
import { allCharterRules, parseCharterMarkdown } from './CharterParser';
import type { Stage, StageRuntime, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { CharterFeedbackCandidate } from './CharterFeedbackTypes';

const MIN_RECORD_CHARS = 12;
const MAX_RECORD_CHARS = 480;

function stripPhasePrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, '').trim() || title;
}

function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[「」"'`]/g, '')
    .trim();
}

function isDuplicateOfExistingCharter(text: string, charter: CharterDocument | null): boolean {
  if (!charter) {
    return false;
  }
  const norm = normalizeForDedup(text);
  if (!norm) {
    return true;
  }
  return allCharterRules(charter).some((rule) => {
    const existing = normalizeForDedup(rule.text);
    return existing === norm || existing.includes(norm) || norm.includes(existing);
  });
}

function shouldIncludeProvenance(provenance: DecisionProvenance | undefined): boolean {
  if (!provenance || provenance === 'charter_direct') {
    return false;
  }
  return provenance === 'human' || provenance === 'escalated' || provenance === 'charter_inferred';
}

function inferSuggestedType(text: string): CharterRuleType {
  if (/避免|不要|禁止|勿|exclude|avoid|never/i.test(text)) {
    return 'avoid';
  }
  if (/必须|不得|约束|require|must|mandatory/i.test(text)) {
    return 'constraint';
  }
  if (/升级|难逆转|escalat|adr/i.test(text)) {
    return 'escalate';
  }
  if (/可接受|折中|acceptable|compromise/i.test(text)) {
    return 'acceptable';
  }
  return 'prefer';
}

function reasonForProvenance(provenance: DecisionProvenance): string {
  switch (provenance) {
    case 'human':
      return '人工批准决策';
    case 'escalated':
      return '主旨未覆盖或冲突后人工拍板';
    case 'charter_inferred':
      return '主旨推导项经人工确认';
    default:
      return '会话决策';
  }
}

function decisionRecordForStage(stage: Stage, runtime: StageRuntime): string {
  const raw = String(
    runtime.approvedDecisionRecord ?? runtime.outputs[PRIMARY_DECISION_OUTPUT_KEY] ?? '',
  ).trim();
  return raw.slice(0, MAX_RECORD_CHARS);
}

function collectFromDecisionStage(
  stage: Stage,
  runtime: StageRuntime,
  charter: CharterDocument | null,
): CharterFeedbackCandidate | null {
  if (stage.isDecisionStage !== true || runtime.status !== 'done') {
    return null;
  }
  const provenance = runtime.decisionProvenance ?? 'human';
  if (!shouldIncludeProvenance(provenance)) {
    return null;
  }
  const decisionRecord = decisionRecordForStage(stage, runtime);
  if (decisionRecord.length < MIN_RECORD_CHARS) {
    return null;
  }
  if (isDuplicateOfExistingCharter(decisionRecord, charter)) {
    return null;
  }
  return {
    stageId: stage.id,
    stageTitle: stripPhasePrefix(stage.title),
    decisionRecord,
    provenance,
    suggestedType: inferSuggestedType(decisionRecord),
    reason: reasonForProvenance(provenance),
  };
}

/**
 * 从已完成工作流实例收集建议回写 Charter 的决策（B-R2γ 启发式）。
 * - 含：human / escalated / charter_inferred（经人工确认）
 * - 排除：未改动的 charter_direct、过短文本、与现有规则重复
 */
export function collectCharterFeedbackCandidates(
  instance: WorkflowInstance,
  charterRaw?: string,
  charterPath = 'charter.md',
): CharterFeedbackCandidate[] {
  const { definition, stageRuntimes } = instance;
  const charter = charterRaw
    ? parseCharterMarkdown(charterPath, charterRaw)
    : null;
  const out: CharterFeedbackCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < definition.stages.length; i++) {
    const stage = definition.stages[i]!;
    const runtime = stageRuntimes[i];
    if (!runtime) {
      continue;
    }
    const item = collectFromDecisionStage(stage, runtime, charter);
    if (!item) {
      continue;
    }
    const key = normalizeForDedup(item.decisionRecord);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 测试/编排用：从 definition + runtimes 收集（无 instance 包装）。 */
export function collectCharterFeedbackFromWorkflow(
  definition: WorkflowDefinition,
  stageRuntimes: StageRuntime[],
  charterRaw?: string,
  charterPath = 'charter.md',
): CharterFeedbackCandidate[] {
  return collectCharterFeedbackCandidates(
    { definition, stageRuntimes } as WorkflowInstance,
    charterRaw,
    charterPath,
  );
}
