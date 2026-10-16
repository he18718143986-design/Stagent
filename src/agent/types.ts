/**
 * AI 执行能力的适配器接口（规格 §8）。核心账本不直接依赖 Claude：所有 AI 能力收敛到 AgentExecutor，
 * Claude Code（src/agent/claude-code.ts）是第一个实现，测试用 ScriptedExecutor（src/agent/scripted.ts）。
 *
 * 不变量：AI 的任何输出都只是"声称"（D10）。implement / fix 的回报只会被写成 claim.reported，
 * 永远不会直接产生 run.completed 或任何"已验证"（Invariant 1）。
 */
import type { ExampleKind, FileAttribution, PlanStep, RecordKind, Track } from '../ledger/types.js';

export interface AgentUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** 美元，SDK 的 total_cost_usd（估算值，不是账单）。 */
  estimatedCost: number;
}

export interface AgentProgress {
  /** 一行状态（前端「进行中」区域只显示这一行）。 */
  line: string;
  /** 展开日志里追加的一段。 */
  log?: string;
}

export interface AgentContext {
  projectRoot: string;
  signal?: AbortSignal;
  onProgress?: (p: AgentProgress) => void;
  /** 拿到会话 id 时回调（起草会话据此在守卫里放行 .stagent/checks/draft/**）。 */
  onSession?: (sessionId: string) => void;
  /** 续接中断的会话（SDK 支持 resume，§8 spike）。 */
  resume?: string;
  /** 本次调用最多花多少美元（费用上限剩余额度）。 */
  maxBudgetUsd?: number;
}

export interface AgentOutcome<T> {
  value: T;
  usage: AgentUsage | null;
  sessionId: string | null;
}

/** 给 AI 的功能清单摘要。 */
export interface FeatureBrief {
  featureId: string;
  name: string;
  stateLabel: string;
  examples: string[];
  files: string[];
}

export interface ClassifyInput {
  description: string;
  features: FeatureBrief[];
  systemMap: string;
}

export interface Classification {
  track: Track;
  targetFeatureIds: string[];
  /** 需求会触及 ≥ 2 个功能或需要 ≥ 2 次独立验收时为 true（§5.5）。 */
  suggestPlan: boolean;
  rationale: string;
}

export interface DraftPlanInput {
  requirement: string;
  features: FeatureBrief[];
  systemMap: string;
}

export interface DraftedPlan {
  steps: PlanStep[];
  rationale: string;
}

export interface AttributeFilesInput {
  files: string[];
  features: FeatureBrief[];
  targetFeatureIds: string[];
  /** 已有映射：path → featureIds。 */
  existing: Record<string, string[]>;
  description: string;
}

export interface DraftExamplesInput {
  /** new：新功能档；baseline：接入时为已有功能补基线；rewrite：先失败检查不合格后重写一条。 */
  mode: 'new' | 'baseline' | 'rewrite';
  requirement: string;
  featureName: string;
  features: FeatureBrief[];
  /** 只能写到这个目录下（相对项目根目录，.stagent/checks/draft/...）。 */
  draftDir: string;
  checkCommand: string;
  rewrite?: { given: string; when: string; then: string; checkPath: string; log: string };
}

export interface DraftedExample {
  given: string;
  when: string;
  then: string;
  kind: ExampleKind;
  /** AI 写好的检查文件（相对项目根目录，必须在 draftDir 下）。 */
  checkPath: string;
  /** 大白话摘要："这条检查实际在看什么"。 */
  summary: string;
}

export interface LockedExampleBrief {
  exampleId: string;
  featureName: string;
  given: string;
  when: string;
  then: string;
  checkPath: string;
}

export interface ImplementInput {
  changeId: string;
  description: string;
  examples: LockedExampleBrief[];
  rules: string[];
  /** 目标功能在系统地图中的已知文件（"从哪里入手"的提示，不限制改动范围）。 */
  knownFiles: string[];
}

export interface FixInput extends ImplementInput {
  round: number;
  failures: { exampleId: string; featureName: string; then: string; status: string; log: string }[];
  /** 被破坏功能的文件 ∩ 本改动 diff（§4.5 失败定位）。 */
  possiblyRelatedFiles: string[];
}

/** 按固定格式回报（改了什么、做了哪些取舍）；解析失败时 malformed=true、原文入库。 */
export interface ClaimReport {
  text: string;
  changed: string;
  tradeoffs: string;
  /** AI 声称已实现的例子。 */
  claimedExampleIds: string[];
  malformed: boolean;
}

export interface DecisionQuestionInput {
  card: { question: string; background: string; options: { label: string; pros?: string; cons?: string }[] };
  question: string;
}

export interface ScannedFeature {
  name: string;
  description: string;
  entryFiles: string[];
}

export interface DraftRecordsInput {
  change: { description: string; track: Track };
  claims: string[];
  failures: string[];
  authReasons: string[];
}

export interface DraftedRecord {
  kind: RecordKind;
  title: string;
  body: string;
  tags: string[];
}

export interface DraftRuleInput {
  tag: string;
  pitfalls: { title: string; body: string }[];
}

export interface DraftedRule {
  text: string;
  appliesWhen: string;
  expiresWhen: string;
}

export interface AgentAvailability {
  available: boolean;
  /** 不可用时给人看的原因与解决命令。 */
  reason?: string;
  hint?: string;
}

export interface AgentExecutor {
  readonly name: string;
  availability(): Promise<AgentAvailability>;
  classifyChange(input: ClassifyInput, ctx: AgentContext): Promise<AgentOutcome<Classification>>;
  draftPlan(input: DraftPlanInput, ctx: AgentContext): Promise<AgentOutcome<DraftedPlan>>;
  attributeFiles(input: AttributeFilesInput, ctx: AgentContext): Promise<AgentOutcome<FileAttribution[]>>;
  draftExamples(input: DraftExamplesInput, ctx: AgentContext): Promise<AgentOutcome<DraftedExample[]>>;
  implement(input: ImplementInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>>;
  fix(input: FixInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>>;
  answerDecisionQuestion(input: DecisionQuestionInput, ctx: AgentContext): Promise<AgentOutcome<string>>;
  /** 接入扫描（§9，只读）；每识别出一个功能就回调 onFeature，实现"流式返回功能清单"。 */
  scanFeatures(input: { stackHint: string }, ctx: AgentContext & { onFeature?: (f: ScannedFeature) => void }): Promise<AgentOutcome<ScannedFeature[]>>;
  draftRecords(input: DraftRecordsInput, ctx: AgentContext): Promise<AgentOutcome<DraftedRecord[]>>;
  draftRule(input: DraftRuleInput, ctx: AgentContext): Promise<AgentOutcome<DraftedRule>>;
}
