import type { CharterFeedbackCandidate } from '../charter/CharterFeedbackTypes';

export interface CharterFeedbackPromptResult {
  written: boolean;
  appendedCount: number;
  absolutePath: string;
}

/** autoAI：Charter 反馈提示（headless no-op）。 */
export async function showCharterFeedbackPrompt(
  _candidates: CharterFeedbackCandidate[],
  _workspaceRoot: string,
  _charterRelativePath: string,
): Promise<CharterFeedbackPromptResult | undefined> {
  return undefined;
}
