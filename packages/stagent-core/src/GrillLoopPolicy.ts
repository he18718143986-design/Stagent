import type { Question } from './WorkflowDefinition';
import { getMissingRequiredQuestionIds } from './QuestionBeforeFlow';

/**
 * M23：自适应「一次一问」grill（借鉴 skills `grill-me` / `grill-with-docs`）。
 *
 * 默认 questionBefore 一次性抛出全部问题；自适应模式改为**逐题**澄清：每轮只问一个最关键的
 * 未答问题，并优先尝试「查真实代码」回答可由代码事实定夺的问题（减少打扰用户）。
 *
 * 纯函数，便于单测；引擎在 `stagent.grill.adaptiveMode === true` 时消费。对应 SPEC §4.x grilling 子状态。
 */

export const DEFAULT_MAX_GRILL_ROUNDS = 6;

/** 该问题是否可通过查阅现有代码/产物事实回答（从而不必打扰用户）。 */
export function isCodeExplorableQuestion(question: Pick<Question, 'text' | 'hint'>): boolean {
  const blob = `${question.text ?? ''} ${question.hint ?? ''}`;
  // 询问「现状/已有事实」类 → 可查代码；询问「偏好/取舍/期望」类 → 必须问人
  const factSignals =
    /现有|已有|当前(代码|实现|项目)|目前|existing|current\s+(code|impl|behavior)|which\s+file|where\s+is|是否已经存在|用了哪些|依赖了什么|调用了/i;
  const preferenceSignals =
    /希望|偏好|更想|应该用|要不要|选哪|权衡|取舍|prefer|trade[\s-]?off|would you|do you want|acceptable|预算|优先级/i;
  if (preferenceSignals.test(blob)) {
    return false;
  }
  return factSignals.test(blob);
}

export interface GrillProgress {
  total: number;
  answered: number;
  remainingRequiredIds: string[];
  remainingOptionalIds: string[];
}

export function buildGrillProgress(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): GrillProgress {
  const list = questions ?? [];
  const answered = list.filter((q) => String(answers?.[q.id] ?? '').trim()).length;
  const remainingRequiredIds = getMissingRequiredQuestionIds(questions, answers);
  const remainingOptionalIds = list
    .filter((q) => q.required === false)
    .filter((q) => !String(answers?.[q.id] ?? '').trim())
    .map((q) => q.id);
  return { total: list.length, answered, remainingRequiredIds, remainingOptionalIds };
}

/** 逐题选择：优先未答的必答题，按 questions 顺序返回**一个**问题；都答完返回 undefined。 */
export function selectNextGrillQuestion(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): Question | undefined {
  const list = questions ?? [];
  const missingRequired = new Set(getMissingRequiredQuestionIds(questions, answers));
  const nextRequired = list.find((q) => missingRequired.has(q.id));
  if (nextRequired) {
    return nextRequired;
  }
  return list.find((q) => q.required === false && !String(answers?.[q.id] ?? '').trim());
}

export type GrillAction =
  | { kind: 'done' }
  | { kind: 'max-rounds-reached' }
  | { kind: 'explore-code'; question: Question }
  | { kind: 'ask'; question: Question };

/**
 * 自适应 grill 单步决策：
 * - 无未答必答题 → done（可选题不强制阻断）
 * - 超过最大轮次 → max-rounds-reached（避免无限循环，引擎放行）
 * - 下一题可查代码 → explore-code（先查再决定是否仍需问）
 * - 否则 → ask（向用户问这一题）
 */
export function nextGrillAction(input: {
  questions: Question[] | undefined;
  answers: Record<string, string> | undefined;
  round: number;
  maxRounds?: number;
}): GrillAction {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_GRILL_ROUNDS;
  if (getMissingRequiredQuestionIds(input.questions, input.answers).length === 0) {
    return { kind: 'done' };
  }
  if (input.round >= maxRounds) {
    return { kind: 'max-rounds-reached' };
  }
  const next = selectNextGrillQuestion(input.questions, input.answers);
  if (!next) {
    return { kind: 'done' };
  }
  return isCodeExplorableQuestion(next)
    ? { kind: 'explore-code', question: next }
    : { kind: 'ask', question: next };
}
