import type { BackendMessage, InputSource, Stage, StageRuntime } from './WorkflowDefinition';
import {
  classifyStageOutputSource,
  planInputDegradeMode,
  pickEntryIndexToDegrade,
  resolveExplicitContextDegradeMode,
  thresholdsForRole,
  type InputDegradeMode,
  type InputSourceRole,
} from './InputContextPolicy';
import {
  estimateTokens,
  stageOutputToText,
  toReferenceText,
} from './WorkflowInputContent';
import { fileNotFound, stageNotFound } from './ErrorTypeUtils';
import type { InputResolverContext, InputResolverDeps } from './WorkflowInputResolver';
import { LOG_PREVIEW_SHORT } from './LogPreviewLimits';
import {
  DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS,
  DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
} from './InputTokenBudgets';
import { resolveInputSourceContent } from './InputSourceStrategies';
import { DEBUG_EVENT_DEGRADE_MODE_SWITCH } from './DebugLogEvents';
import { llmContextOverflow } from './ErrorTypeUtils';

export type ResolveInputEntry = {
  label: string;
  content: string;
  mode: InputDegradeMode;
  preservePriority: boolean;
  /** source.required === true：硬保留，宁可抛 llmContextOverflow 也不降级。 */
  hardRequired: boolean;
  source?: InputSource;
  role: InputSourceRole;
};

function readStageOutputSource(
  ctx: InputResolverContext,
  source: InputSource,
  stage: Stage,
  deps: Pick<InputResolverDeps, 'warn'>,
): string {
  const idx = ctx.definition.stages.findIndex((s) => s.id === source.stageId);
  if (idx < 0) {
    throw stageNotFound(source.stageId);
  }
  const out = ctx.stageRuntimes[idx].outputs[source.outputKey ?? ''];
  const text = stageOutputToText(out);
  if (text.length === 0) {
    deps.warn(`empty-stage-output-source stage=${stage.id} srcStage=${source.stageId} outputKey=${source.outputKey ?? ''}`);
  }
  return text;
}

export async function buildResolveInputEntries(
  ctx: InputResolverContext,
  stage: Stage,
  runtime: StageRuntime,
  deps: InputResolverDeps,
  truncateTokens: number = DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
): Promise<ResolveInputEntry[]> {
  const entries: ResolveInputEntry[] = [];

  for (let index = 0; index < stage.input.sources.length; index++) {
    const source = stage.input.sources[index];
    const label = source.label?.trim() || `source_${index + 1}`;
    if (source.type !== 'stage-output') {
      entries.push({
        label,
        content: await resolveInputSourceContent(ctx, source, stage, deps, truncateTokens),
        mode: 'full',
        preservePriority: source.required === true,
        hardRequired: source.required === true,
        source,
        role: 'default',
      });
      continue;
    }

    const raw = readStageOutputSource(ctx, source, stage, deps);
    const role = classifyStageOutputSource(source);
    const tokens = estimateTokens(raw);
    const planned = resolveExplicitContextDegradeMode(source, tokens, role) ?? planInputDegradeMode(tokens, role);
    const hardRequired = source.required === true;
    const preservePriority = thresholdsForRole(role).preserveOnTotalOverflow || hardRequired;

    if (planned === 'full') {
      entries.push({ label, content: raw, mode: 'full', preservePriority, hardRequired, source, role });
    } else if (planned === 'summary') {
      const summary = await deps.summarizeForInput(stage.id, label, raw);
      deps.recordContextDegrade?.({
        stageId: stage.id,
        label,
        fromTokens: tokens,
        toTokens: estimateTokens(summary),
        to: 'summary',
      });
      entries.push({ label, content: summary, mode: 'summary', preservePriority, hardRequired, source, role });
    } else {
      const refContent = toReferenceText(source, raw);
      deps.warn(`input-degrade-reference stage=${stage.id} label=${label}`);
      deps.debugLog(stage.id, DEBUG_EVENT_DEGRADE_MODE_SWITCH, runtime.retryCount + 1, {
        label,
        to: 'reference',
        role,
        fromTokens: tokens,
        toTokens: estimateTokens(refContent),
      });
      deps.recordContextDegrade?.({
        stageId: stage.id,
        label,
        fromTokens: tokens,
        toTokens: estimateTokens(refContent),
        to: 'reference',
      });
      entries.push({
        label,
        content: refContent,
        mode: 'reference',
        preservePriority,
        hardRequired,
        source,
        role,
      });
    }
  }

  return entries;
}

export async function applyInputTruncationPolicy(
  entries: ResolveInputEntry[],
  stage: Stage,
  runtime: StageRuntime,
  deps: Pick<
    InputResolverDeps,
    'summarizeForInput' | 'warn' | 'debugLog' | 'onContextOverflow' | 'recordContextDegrade'
  >,
  totalLimit: number = DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS,
): Promise<ResolveInputEntry[]> {
  const next = [...entries];
  let totalTokens = next.reduce((sum, e) => sum + estimateTokens(e.content), 0);
  while (totalTokens > totalLimit) {
    const candidateIdx = pickEntryIndexToDegrade(
      next.map((e) => ({
        mode: e.mode,
        preservePriority: e.preservePriority,
        tokenCount: estimateTokens(e.content),
        hardRequired: e.hardRequired,
      })),
    );
    if (candidateIdx < 0) {
      // 剩余可降级项已耗尽（含 required 硬保留项无法压缩）→ 显式 overflow，不静默截断 required 内容。
      deps.onContextOverflow?.(stage, runtime, totalTokens, totalLimit);
      throw llmContextOverflow();
    }

    const candidate = next[candidateIdx];
    const fromTokens = estimateTokens(candidate.content);
    if (candidate.mode === 'full') {
      const summarized = await deps.summarizeForInput(stage.id, candidate.label, candidate.content);
      if (
        summarized.length < candidate.content.length &&
        summarized === candidate.content.slice(0, summarized.length)
      ) {
        deps.warn(
          `input-summary-truncation-fallback stage=${stage.id} label=${candidate.label} hint=check stagent.llmTimeoutSeconds or model availability`,
        );
      }
      next[candidateIdx] = { ...candidate, content: summarized, mode: 'summary' };
      deps.recordContextDegrade?.({
        stageId: stage.id,
        label: candidate.label,
        fromTokens,
        toTokens: estimateTokens(summarized),
        to: 'summary',
      });
    } else {
      const refContent = candidate.source
        ? toReferenceText(candidate.source, candidate.content)
        : `[reference]\nlabel=${candidate.label}\npreview=${candidate.content.slice(0, LOG_PREVIEW_SHORT).replace(/\s+/g, ' ').trim()}`;
      next[candidateIdx] = { ...candidate, content: refContent, mode: 'reference' };
      deps.warn(`input-degrade-summary-to-reference stage=${stage.id} label=${candidate.label}`);
      deps.debugLog(stage.id, DEBUG_EVENT_DEGRADE_MODE_SWITCH, runtime.retryCount + 1, {
        label: candidate.label,
        from: 'summary',
        to: 'reference',
        fromTokens,
        toTokens: estimateTokens(refContent),
      });
      deps.recordContextDegrade?.({
        stageId: stage.id,
        label: candidate.label,
        fromTokens,
        toTokens: estimateTokens(refContent),
        to: 'reference',
      });
    }
    totalTokens = next.reduce((sum, e) => sum + estimateTokens(e.content), 0);
  }
  return next;
}

export function mergeResolvedInputEntries(
  stage: Stage,
  entries: ResolveInputEntry[],
  deps: Pick<InputResolverDeps, 'warn'>,
): string {
  switch (stage.input.mergeStrategy) {
    case 'template': {
      let template = stage.input.mergeTemplate ?? '';
      for (const e of entries) {
        template = template.split(`{{${e.label}}}`).join(e.content);
      }
      const unmatched = Array.from(template.matchAll(/\{\{([^}]+)\}\}/g)).map((m) => m[1].trim());
      if (unmatched.length > 0) {
        deps.warn(
          `template 未命中占位符，stage=${stage.id}, unmatched=${Array.from(new Set(unmatched)).join(', ')}`,
        );
        template += `\n\n[未替换占位符: ${Array.from(new Set(unmatched)).join(', ')}]`;
      }
      return template || entries.map((e) => e.content).join('\n\n');
    }
    case 'object': {
      const obj: Record<string, string> = {};
      for (const e of entries) {
        obj[e.label] = e.content;
      }
      return JSON.stringify(obj);
    }
    case 'concat':
    default:
      return entries.map((e) => e.content).join('\n\n');
  }
}
