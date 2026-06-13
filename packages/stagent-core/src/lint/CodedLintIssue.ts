/** 通用 lint issue push 工具（code/message 与 type/detail 两种形状）。 */
export interface CodedLintIssue<C extends string = string> {
  code: C;
  message: string;
}

export function pushCodedLintIssue<C extends string>(
  issues: CodedLintIssue<C>[],
  code: C,
  message: string,
): void {
  issues.push({ code, message });
}

export function pushTypedDetailIssue<T extends string>(
  issues: { type: T; detail: string }[],
  type: T,
  detail: string,
): void {
  issues.push({ type, detail });
}

export function pushTypedMessageIssue<T extends string>(
  issues: { type: T; message: string }[],
  type: T,
  message: string,
): void {
  issues.push({ type, message });
}
