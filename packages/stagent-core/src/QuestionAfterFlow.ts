import type { Question, Stage, StageRuntime } from './WorkflowDefinition';

export function buildAnswerQuestionsMessage(stageId: string, answers: Record<string, string>) {
  return { type: 'answerQuestions', stageId, answers } as const;
}

/** I-8 校验结果：M14.1 落地 SPEC §9.1 I-8（必答问题答案为空时拒绝 answerQuestions）。 */
export interface RequiredAnswerCheck {
  ok: boolean;
  missingIds: string[];
}

/**
 * I-8 纯函数：校验「required=true 的 Question 是否有非空答案」。
 *
 * - `Question.required` 默认值为 `true`（见 WorkflowDefinition.ts §4.3 / Question 注释）：
 *   undefined / null / true 一律视为「必答」；仅显式 `false` 视为「可选」。
 * - 「非空」判定：去除首尾空白后非空字符串。
 * - questions 为 undefined / 空数组时返回 ok（无必答即无违反）。
 *
 * 调用方（WorkflowEngine.answerQuestions / answerQuestionsBefore）应在
 * 推 `stageStatusUpdate('done')` 之前调用此函数；missingIds 非空时推
 * `stageError(errorType:'invariant-violation')` 并不推进。
 */
export function validateRequiredAnswers(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): RequiredAnswerCheck {
  const list = questions ?? [];
  const a = answers ?? {};
  const missingIds: string[] = [];
  for (const q of list) {
    // required 默认 true（参见 Question 类型定义）。仅显式 false 视为可选。
    const isRequired = q.required !== false;
    if (!isRequired) continue;
    const raw = a[q.id];
    if (raw === undefined || raw === null) {
      missingIds.push(q.id);
      continue;
    }
    if (typeof raw !== 'string' || raw.trim() === '') {
      missingIds.push(q.id);
    }
  }
  return { ok: missingIds.length === 0, missingIds };
}

/** 含 questionAfter 时禁止走普通 `approve`，须通过 Webview 提交 `answerQuestions`（SKILLS §2 / Milestone 3）。 */
export function blocksDirectApproveForQuestionAfter(stage: Pick<Stage, 'questionAfter'>): boolean {
  return (stage.questionAfter?.length ?? 0) > 0;
}

/**
 * I-20：普通 `approve` 是否允许作用于该阶段（M14.2 深度防御）。
 *
 * `isDecisionStage === true` 的阶段**必须**走 `approveDecision`（携带 decisionRecord 提交）；
 * 直接发 `approve` 会绕过决策清单写入与 §4.4 内容契约。引擎层应直接拒绝，不依赖 UI 防线（UI 已通过
 * `WebviewPauseUiState` 隐藏普通批准按钮，但消息可被伪造或来自旧版面板）。
 *
 * 与 `blocksDirectApproveForQuestionAfter` 是两条独立闸门：
 *   - 此函数：阻挡决策阶段的普通 approve（I-20）
 *   - 上者：阻挡含 questionAfter 阶段的普通 approve（避免跳过追问）
 */
export function isPlainApproveAllowedForStage(stage: Pick<Stage, 'isDecisionStage'>): boolean {
  return stage.isDecisionStage !== true;
}

export function shouldAutoAdvanceAfterAnswers(
  stage: Stage | undefined,
  runtime: StageRuntime | undefined,
  currentStageIndex: number,
  stageIndex: number,
): boolean {
  if (!stage || !runtime) {
    return false;
  }
  if (currentStageIndex !== stageIndex) {
    return false;
  }
  if (runtime.status !== 'paused') {
    return false;
  }
  return (stage.questionAfter?.length ?? 0) > 0;
}

export function applyQuestionAfterAnswers(
  runtime: StageRuntime,
  answers: Record<string, string>,
  nowIso: string,
): void {
  runtime.questionAnswers = { ...runtime.questionAnswers, ...answers };
  runtime.status = 'done';
  runtime.completedAt = nowIso;
}
