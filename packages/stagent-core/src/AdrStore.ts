import { ADR_DECISION_RECORD_PREVIEW_CHARS } from './LogPreviewLimits';

/**
 * M24：轻量 ADR（Architecture Decision Record）留存（借鉴 skills `grill-with-docs`
 * 的 ADR-FORMAT 与 `docs/adr/0001-...md`）。
 *
 * 决策阶段批准时，可把 decisionRecord 的关键取舍落成一条编号 ADR，存进
 * `.stagent/adr/NNNN-<slug>.md`，形成可追溯的架构决策档案。
 *
 * 纯函数：编号 / 文件名 / 渲染 / 从已有文件名解析编号。
 */

export type AdrStatus = 'proposed' | 'accepted' | 'superseded';

export interface AdrRecord {
  number: number;
  title: string;
  status: AdrStatus;
  date: string;
  context: string;
  decision: string;
  consequences: string;
}

/** 把任意标题压成 ADR 文件名 slug（小写、连字符、ASCII 友好）。 */
export function slugifyAdrTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'decision';
}

/** 4 位补零编号。 */
export function formatAdrNumber(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(4, '0');
}

/** `.stagent/adr/NNNN-<slug>.md` 的文件名（不含目录）。 */
export function adrFileName(adr: Pick<AdrRecord, 'number' | 'title'>): string {
  return `${formatAdrNumber(adr.number)}-${slugifyAdrTitle(adr.title)}.md`;
}

/** 从已有 ADR 文件名中提取编号，返回下一个可用编号（从 1 起）。 */
export function nextAdrNumber(existingFileNames: string[]): number {
  let max = 0;
  for (const name of existingFileNames) {
    const m = /^(\d{1,6})-/.exec(name.trim());
    if (m) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

/** 渲染 ADR Markdown（与 skills ADR-FORMAT 对齐：Status / Context / Decision / Consequences）。 */
export function renderAdrMarkdown(adr: AdrRecord): string {
  return [
    `# ${formatAdrNumber(adr.number)}. ${adr.title}`,
    '',
    `- Status: ${adr.status}`,
    `- Date: ${adr.date}`,
    '',
    '## Context',
    '',
    adr.context.trim(),
    '',
    '## Decision',
    '',
    adr.decision.trim(),
    '',
    '## Consequences',
    '',
    adr.consequences.trim(),
    '',
  ].join('\n');
}

export interface ShouldCreateAdrInput {
  stageId: string;
  stageTitle: string;
  decisionRecord: string;
}

export interface ShouldCreateAdrResult {
  create: boolean;
  gates: {
    hardToReverse: boolean;
    confusingWithoutContext: boolean;
    realTradeoff: boolean;
  };
  reasons: string[];
}

const HARD_TO_REVERSE_HINT =
  /(不可逆|难以回滚|回滚成本|迁移成本|breaking|长期|架构|schema|协议|持久化|全局|cross-cutting|fundamental)/i;
const CONFUSING_HINT =
  /(多模块|跨模块|全局|架构|新人|without context|若无.*背景|依赖链|上下游|接口契约)/i;
const TRADEOFF_HINT =
  /(权衡|利弊|trade[- ]?off|vs\.?|versus|方案\s*[AB12]|alternative|instead of|或者.*或者|二选一|取舍)/i;

export function isGlobalArchitectureDecisionStage(stageId: string): boolean {
  return /global[_-]?arch/i.test(stageId) || stageId === 'stage_decide_global_architecture';
}

export function shouldCreateAdr(input: ShouldCreateAdrInput): ShouldCreateAdrResult {
  const text = input.decisionRecord.trim();
  const gates = {
    hardToReverse: HARD_TO_REVERSE_HINT.test(text) || isGlobalArchitectureDecisionStage(input.stageId),
    confusingWithoutContext:
      CONFUSING_HINT.test(text) ||
      isGlobalArchitectureDecisionStage(input.stageId) ||
      /stage_decide_/.test(input.stageId),
    realTradeoff: TRADEOFF_HINT.test(text),
  };
  const reasons: string[] = [];
  if (gates.hardToReverse) reasons.push('hard-to-reverse');
  if (gates.confusingWithoutContext) reasons.push('confusing-without-context');
  if (gates.realTradeoff) reasons.push('real-tradeoff');
  const create = isGlobalArchitectureDecisionStage(input.stageId) || reasons.length >= 2;
  return { create, gates, reasons };
}

function extractDecisionSubsection(markdown: string, titleRegex: RegExp): string {
  const m = titleRegex.exec(markdown);
  if (!m || m.index === undefined) return '';
  const rest = markdown.slice(m.index + m[0].length);
  const next = /\n###[\t ]/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export function buildAdrRecordFromDecision(
  input: ShouldCreateAdrInput & { number: number; date?: string },
): AdrRecord {
  const { decisionRecord, stageId, stageTitle, number } = input;
  const boundary = extractDecisionSubsection(decisionRecord, /^###[\t ]+职责边界[\t ]*$/m);
  const keyDecision = extractDecisionSubsection(decisionRecord, /^###[\t ]+关键设计决策[\t ]*$/m);
  const pressure = extractDecisionSubsection(
    decisionRecord,
    /^###[\t ]+(?:★[\t ]*)?边界压力测试(?:（v2\.0 新增）)?[\t ]*$/m,
  );
  const assumptions = extractDecisionSubsection(decisionRecord, /^###[\t ]+AI[\t ]*无法验证的假设[\t ]*$/m);
  const contextParts = [
    boundary,
    keyDecision ? '' : decisionRecord.slice(0, ADR_DECISION_RECORD_PREVIEW_CHARS),
  ].filter(Boolean);
  const consequencesParts = [pressure, assumptions].filter(Boolean);
  return {
    number,
    title: stageTitle.trim() || stageId,
    status: 'accepted',
    date: input.date ?? new Date().toISOString().slice(0, 10),
    context: contextParts.join('\n\n').trim() || `Decision stage ${stageId}`,
    decision: keyDecision || decisionRecord.trim(),
    consequences: consequencesParts.join('\n\n').trim() || '（待补充：批准时的边界压力测试 / 假设）',
  };
}

const ADR_HEADING = /^#\s+(\d{4})\.\s+(.+)$/m;
const ADR_STATUS = /^- Status:\s*(\w+)/im;

export function parseAdrSummary(content: string): { number: number; title: string; status: AdrStatus } | undefined {
  const hm = ADR_HEADING.exec(content);
  if (!hm) return undefined;
  const sm = ADR_STATUS.exec(content);
  const status = (sm?.[1]?.toLowerCase() as AdrStatus | undefined) ?? 'accepted';
  return { number: Number(hm[1]), title: hm[2].trim(), status };
}

export function formatAdrIndexForPrompt(
  summaries: Array<{ number: number; title: string; status: AdrStatus }>,
): string {
  if (summaries.length === 0) return '';
  const accepted = summaries.filter((s) => s.status === 'accepted');
  const lines = (accepted.length > 0 ? accepted : summaries)
    .sort((a, b) => a.number - b.number)
    .map((s) => `- ADR-${formatAdrNumber(s.number)} ${s.title} (${s.status})`);
  return [
    '【已有架构决策（ADR）— 请勿重复 litigate 已 accepted 的条目】',
    ...lines,
    '若用户任务与某 ADR 范围重合，应引用该 ADR 并在实现中遵循，而非新建语义重复的 decision 阶段。',
  ].join('\n');
}

export { STAGENT_ADR_DIR } from './paths/StagentPaths';
