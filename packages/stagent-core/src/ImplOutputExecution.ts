import { isHollowImplOutput } from './ImplOutputGuard';

export interface ImplOutputGuardResult {
  text: string;
  note: string;
}

export async function executeImplWithHollowGuard(
  systemPrompt: string,
  userContent: string,
  execute: (systemPrompt: string, userContent: string) => Promise<string>,
): Promise<ImplOutputGuardResult> {
  const first = await execute(systemPrompt, userContent);
  if (!isHollowImplOutput(first)) {
    return { text: first, note: '' };
  }

  const retryHint =
    'The previous output was a confirmation, not code. Output ONLY the implementation file, no commentary.';
  const retried = await execute(
    `${systemPrompt}\n\n自动质量兜底：${retryHint}`,
    `${userContent}\n\n请仅输出实现文件内容，不要解释、不要确认话术。`,
  );
  if (isHollowImplOutput(retried)) {
    throw new Error('impl-hollow-output');
  }
  return {
    text: retried,
    note: '实现阶段空洞输出已通过自动重试纠正。',
  };
}
