import * as path from 'path';
import type { CharterFeedbackCandidate } from './CharterFeedbackTypes';
import { appendCharterFeedbackEntries } from './CharterWriter';
import { clearCharterCache } from './CharterContextService';

export interface AutoWriteCharterFeedbackResult {
  written: boolean;
  appendedCount: number;
  skippedCount: number;
}

/**
 * B-R4：高置信自动回写（仅 human / escalated；不含 charter_inferred）。
 * charter_inferred 仍走人工确认，降低误写风险。
 */
export function tryAutoWriteCharterFeedback(
  candidates: CharterFeedbackCandidate[],
  workspaceRoot: string,
  charterRelativePath: string,
): AutoWriteCharterFeedbackResult {
  const autoEligible = candidates.filter(
    (c) => c.provenance === 'human' || c.provenance === 'escalated',
  );
  if (autoEligible.length === 0) {
    return { written: false, appendedCount: 0, skippedCount: candidates.length };
  }

  const absPath = path.join(workspaceRoot, charterRelativePath);
  const result = appendCharterFeedbackEntries(
    absPath,
    autoEligible.map((c) => ({
      text: c.decisionRecord,
      type: c.suggestedType,
      stageId: c.stageId,
      provenance: c.provenance,
    })),
  );
  if (result.appendedCount > 0) {
    clearCharterCache();
  }
  return {
    written: result.appendedCount > 0,
    appendedCount: result.appendedCount,
    skippedCount: candidates.length - autoEligible.length,
  };
}
