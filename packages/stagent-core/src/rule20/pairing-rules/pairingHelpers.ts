import type { VerifyContext } from '../verify-context';
import type { VerifyIssue } from '../types';

/** 遍历阶段列表，跳过无法解析 semanticName 的项 */
export function forStagesWithSemanticName<T extends { id: string }>(
  stages: T[],
  extract: (id: string) => string | undefined,
  visit: (stage: T, semanticName: string) => void,
): void {
  for (const stage of stages) {
    const semanticName = extract(stage.id);
    if (!semanticName) {
      continue;
    }
    visit(stage, semanticName);
  }
}

export function pushPairingWarning(ctx: VerifyContext, issue: VerifyIssue): void {
  ctx.warnings.push(issue);
}

export function pushPairingViolation(ctx: VerifyContext, issue: VerifyIssue): void {
  ctx.violations.push(issue);
}
