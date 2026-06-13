import { IMPL_DECISION_CONSTRAINT_SNIPPET } from '../rule20-normalize/types';

/** 与 normalize 注入的 IMPL_DECISION_CONSTRAINT_SNIPPET 对齐（允许尾部「不得偏离」等装饰）。 */
export function promptIncludesDecisionConstraint(prompt: string): boolean {
  const core = IMPL_DECISION_CONSTRAINT_SNIPPET.replace(/[，,].*$/, '').trim();
  return prompt.includes(core);
}
