import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import {
  readCharterEnabled,
  readCharterFeedbackAutoWrite,
  readCharterFeedbackCooldownDays,
  readCharterFeedbackEnabled,
  readCharterRelativePath,
} from '../settings/readers/charter';
import { tryAutoWriteCharterFeedback } from './maybeAutoWriteCharterFeedback';
import { MS_PER_DAY } from '../TimeConstants';
import { collectCharterFeedbackCandidates } from './collectCharterFeedbackCandidates';
import { showCharterFeedbackPrompt } from '../adapters/showCharterFeedbackPrompt';
import type { MessagingHost } from '../engine-host/MessagingHost';

export interface CharterFeedbackPromptDeps {
  getLastAsked: () => string | undefined;
  setLastAsked: (iso: string) => Promise<void>;
}

function resolveWorkspaceRoot(instance: WorkflowInstance): string | undefined {
  const raw = instance.definition.meta.taskWorkspacePath?.trim();
  return raw || undefined;
}

function readCharterTextForCollect(workspaceRoot: string, relativePath: string): string | undefined {
  const abs = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(abs)) {
    return undefined;
  }
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

/** 工作流完成后提示用户将普适决策回写 Charter（B-R2γ）。 */
export async function maybePromptCharterFeedbackAsync(
  host: MessagingHost,
  deps: CharterFeedbackPromptDeps,
): Promise<void> {
  try {
    const instance = host.getInstance();
    if (!instance || instance.status !== 'completed') {
      return;
    }

    const cfg = getStagentConfiguration();
    if (!readCharterEnabled(cfg)) {
      return;
    }
    const feedbackEnabled = readCharterFeedbackEnabled(cfg);
    const autoWrite = readCharterFeedbackAutoWrite(cfg);
    if (!feedbackEnabled && !autoWrite) {
      return;
    }

    const workspaceRoot = resolveWorkspaceRoot(instance);
    if (!workspaceRoot) {
      return;
    }

    const relativePath = readCharterRelativePath(cfg);
    const charterText = readCharterTextForCollect(workspaceRoot, relativePath);
    const candidates = collectCharterFeedbackCandidates(instance, charterText, relativePath);
    if (candidates.length === 0) {
      return;
    }

    let remaining = candidates;
    if (autoWrite) {
      const auto = tryAutoWriteCharterFeedback(candidates, workspaceRoot, relativePath);
      if (auto.written) {
        host.logUserAction('charter_feedback_auto_written', {
          appendedCount: auto.appendedCount,
          charterPath: relativePath,
        });
      }
      remaining = candidates.filter(
        (c) => c.provenance !== 'human' && c.provenance !== 'escalated',
      );
    }

    if (!feedbackEnabled || remaining.length === 0) {
      return;
    }

    const cooldownDays = readCharterFeedbackCooldownDays(cfg);
    const lastAsked = deps.getLastAsked();
    if (lastAsked && cooldownDays > 0) {
      const elapsedDays = (Date.now() - new Date(lastAsked).getTime()) / MS_PER_DAY;
      if (Number.isFinite(elapsedDays) && elapsedDays < cooldownDays) {
        return;
      }
    }

    await deps.setLastAsked(new Date().toISOString());
    const outcome = await showCharterFeedbackPrompt(remaining, workspaceRoot, relativePath);
    if (outcome?.written) {
      host.logUserAction('charter_feedback_written', {
        appendedCount: outcome.appendedCount,
        charterPath: relativePath,
      });
    }
  } catch (e) {
    host.warn(`charter_feedback_prompt_failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
