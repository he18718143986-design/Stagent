import type { BackendMessage, StageRuntime, WorkflowInstance } from '../WorkflowDefinition';
import { formatToolExecutionFailedCopy, parseCodeRunnerExitCode } from '../errors/catalog/toolExecutionCopy';
import { FAILURE_SNAPSHOT_STDIO_MAX } from '../LogPreviewLimits';
import { findFirstFailedStageIndex, resolveTddSliceBounds } from '../TddSliceScope';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { StageFailureSnapshot } from '../workflow-types/RuntimeTypes';

type StageErrorPayload = Omit<Extract<BackendMessage, { type: 'stageError' }>, 'type'>;

export { FAILURE_SNAPSHOT_STDIO_MAX };

export function truncateSnapshotText(text: string | undefined): string | undefined {
  if (text === undefined || text === '') {
    return text;
  }
  if (text.length <= FAILURE_SNAPSHOT_STDIO_MAX) {
    return text;
  }
  return text.slice(-FAILURE_SNAPSHOT_STDIO_MAX);
}

function readExitCodeFromOutputs(outputs: Record<string, unknown>): number | undefined {
  const raw = outputs[CODE_RUNNER_EXIT_OUTPUT_KEY];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveExitCode(runtime: StageRuntime, errorText: string): number | undefined {
  return readExitCodeFromOutputs(runtime.outputs) ?? parseCodeRunnerExitCode(errorText);
}

function buildSnapshotOutputs(
  stdout: string | undefined,
  stderr: string | undefined,
  exitCode: number | undefined,
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  if (exitCode !== undefined) {
    outputs[CODE_RUNNER_EXIT_OUTPUT_KEY] = exitCode;
  }
  const truncStdout = truncateSnapshotText(stdout);
  const truncStderr = truncateSnapshotText(stderr);
  if (truncStdout !== undefined) {
    outputs.stdout = truncStdout;
  }
  if (truncStderr !== undefined) {
    outputs.stderr = truncStderr;
  }
  return outputs;
}

/** 阶段失败时捕获结构化快照，供 LLM 重试自动注入上下文。 */
export function captureFailureSnapshot(runtime: StageRuntime, err: StageErrorPayload): StageFailureSnapshot {
  const stdout =
    err.stdout ??
    (typeof runtime.outputs.stdout === 'string' ? runtime.outputs.stdout : undefined);
  const stderr =
    err.stderr ??
    (typeof runtime.outputs.stderr === 'string' ? runtime.outputs.stderr : undefined);
  const exitCode = resolveExitCode(runtime, err.error);
  const snapshot: StageFailureSnapshot = {
    capturedAt: new Date().toISOString(),
    error: err.error,
    errorType: err.errorType,
    stdout: truncateSnapshotText(stdout),
    stderr: truncateSnapshotText(stderr),
    exitCode,
    outputs: buildSnapshotOutputs(stdout, stderr, exitCode),
  };
  runtime.lastFailureSnapshot = snapshot;
  return snapshot;
}

export function buildAutoRetryComment(snapshot: StageFailureSnapshot, stageId?: string): string {
  const lines: string[] = [];
  if (snapshot.errorType === 'tool-execution-failed' && snapshot.exitCode === 127) {
    const envHint = formatToolExecutionFailedCopy({
      rawError: snapshot.error ?? 'tool-execution-failed: code-runner exitCode=127',
      stderr: snapshot.stderr,
      stageId,
    }).userBody;
    if (envHint.trim()) {
      lines.push(envHint.trim());
    }
  }
  const parts: string[] = [];
  if (snapshot.errorType) {
    parts.push(`errorType=${snapshot.errorType}`);
  }
  if (snapshot.exitCode !== undefined) {
    parts.push(`exitCode=${snapshot.exitCode}`);
  }
  const header = parts.length > 0 ? `上次执行失败（${parts.join('，')}）` : '上次执行失败';
  lines.push(header);
  if (snapshot.stderr?.trim()) {
    lines.push(`stderr 片段：\n${snapshot.stderr.trim()}`);
  } else if (snapshot.error?.trim()) {
    lines.push(`错误摘要：${snapshot.error.trim()}`);
  }
  return lines.join('\n\n');
}

/**
 * LLM 重试 comment 优先级：用户 comment > 本 stage snapshot > 同 TDD 切片 failed stage snapshot。
 * 返回值仅用于 system prompt 注入，不写回 runtime.retryComment（避免 RedGreen FSM retrying 误判）。
 */
export function resolveEffectiveRetryComment(args: {
  instance: WorkflowInstance;
  stageId: string;
  userComment: string;
}): string {
  const trimmed = args.userComment.trim();
  if (trimmed) {
    return trimmed;
  }

  const stageIdx = args.instance.definition.stages.findIndex((s) => s.id === args.stageId);
  if (stageIdx < 0) {
    return '';
  }

  const runtime = args.instance.stageRuntimes[stageIdx];
  if (runtime?.lastFailureSnapshot) {
    return buildAutoRetryComment(runtime.lastFailureSnapshot, args.stageId);
  }

  const failedIdx = findFirstFailedStageIndex(args.instance);
  if (failedIdx < 0 || failedIdx === stageIdx) {
    return '';
  }

  const { start, end } = resolveTddSliceBounds(args.instance.definition, stageIdx);
  if (failedIdx < start || failedIdx >= end) {
    return '';
  }

  const failedRuntime = args.instance.stageRuntimes[failedIdx];
  if (!failedRuntime?.lastFailureSnapshot) {
    return '';
  }

  const failedStageId = args.instance.definition.stages[failedIdx]?.id;
  return buildAutoRetryComment(failedRuntime.lastFailureSnapshot, failedStageId);
}
