import type { AdrCalibrationFeatures } from './calibration/loadCalibrationQuestions';
import { allCharterRules } from './CharterParser';
import type { CharterDocument } from './CharterTypes';
import { CHARTER_MATCH_UNCOVERED_THRESHOLD } from './CharterTypes';
import { keywordOverlapScore } from './CharterKeywords';

export interface AdrCriteriaResult {
  mustEscalate: boolean;
  features: AdrCalibrationFeatures;
  reasons: string[];
}

/** 易逆转 / 惯例级选择 — 命中则 irreversible=false（calibration non-adr 锚点）。 */
const REVERSIBLE_TRIVIAL_RE =
  /测试目录|tests\/|src\/tests|日志格式|structlog|standard\s+logging|指数退避|重试策略|连接超时|超时是否/i;

/** 难逆转：接口/模块边界/公共 API / 事件模型等（问题文本导向）。 */
const IRREVERSIBLE_RE =
  /abstract\s+base\s+class|Protocol|public\s+方法|暴露.{0,40}作为|模块边界|内化|注入|Gateway|Event|subscriber|caller|接口形态|breaking|schema|持久化|架构|契约|模块.{0,8}边界/i;

/** 真实 trade-off：二选一 / vs / 合并取舍（排除单纯「是否实现」类 yes-no）。 */
const TRADEOFF_RE =
  /还是|versus|vs\.?|trade[- ]?off|或者.{0,12}或者|二选一|取舍|内化还是|合并为|设计为.{0,24}还是|是否暴露|是否合并/i;

function scoreCharterCoverage(question: string, charter: CharterDocument | null | undefined): number {
  if (!charter) {
    return 0;
  }
  const rules = allCharterRules(charter);
  if (rules.length === 0) {
    return 0;
  }
  let best = 0;
  for (const rule of rules) {
    best = Math.max(best, keywordOverlapScore(question, rule.keywords));
  }
  return best;
}

function hasCharterCoverage(question: string, charter: CharterDocument | null | undefined): boolean {
  return scoreCharterCoverage(question, charter) >= CHARTER_MATCH_UNCOVERED_THRESHOLD;
}

function detectIrreversible(question: string): boolean {
  if (REVERSIBLE_TRIVIAL_RE.test(question)) {
    return false;
  }
  return IRREVERSIBLE_RE.test(question);
}

function detectTradeoff(question: string): boolean {
  if (/是否实现|是否采用|是否使用|是否添加|是否增加/i.test(question) && !TRADEOFF_RE.test(question)) {
    return false;
  }
  return TRADEOFF_RE.test(question);
}

function detectSurprising(
  question: string,
  charter: CharterDocument | null | undefined,
  irreversible: boolean,
): boolean {
  if (!irreversible) {
    return false;
  }
  return !hasCharterCoverage(question, charter);
}

/**
 * Gate 1：ADR 判据（irreversible ∧ surprising ∧ tradeoff）。
 * 对齐 ADR-0003 §3 / skills grill-with-docs ADR-FORMAT 三门 AND。
 */
export function detectAdrCriteria(
  question: string,
  charter?: CharterDocument | null,
): AdrCriteriaResult {
  const irreversible = detectIrreversible(question);
  const tradeoff = detectTradeoff(question);
  const surprising = detectSurprising(question, charter, irreversible);
  const features: AdrCalibrationFeatures = { irreversible, surprising, tradeoff };
  const reasons: string[] = [];
  if (irreversible) {
    reasons.push('irreversible');
  }
  if (surprising) {
    reasons.push('surprising-without-charter');
  }
  if (tradeoff) {
    reasons.push('tradeoff');
  }
  return {
    mustEscalate: irreversible && surprising && tradeoff,
    features,
    reasons,
  };
}
