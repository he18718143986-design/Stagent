/**
 * 执行链 shim：当前为内联 linear/DAG 循环（与 stagent_vscode WorkflowExecutorLoop 行为对齐中）。
 * 模块化路径 `WorkflowExecutorLoop` + `executor-loop/` 已落盘，待 tsconfig 逐目录启用后切换。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { executeImplWithHollowGuard } from './ImplOutputExecution';
import { shouldEnterWaitingQuestions } from './QuestionBeforeFlow';
import {
  DEFAULT_TOOL_PATH_BASE,
  type BackendMessage,
  type CodeRunnerConfig,
  type FileReadConfig,
  type FileWriteConfig,
  type PatchInstruction,
  type SkipCondition,
  type Stage,
  type StageRuntime,
  type ToolPathBase,
  type WorkflowInstance,
} from './WorkflowDefinition';
import { pickDagExecutionBatch, syncDagCurrentStageIndex } from './WorkflowDag';
import { normalizeLlmOutputForWritePath } from './WriteOutputNormalize';
import { extractJsonValue } from './JsonExtract';
import { collectAllCodeRunnerLintIssues, formatCodeRunnerCommandIssue } from './CodeRunnerCommandLint';
import { collectConfigContractIssuesOnDisk } from './ConfigContractLint';
import { readPriorFileContent } from './ArtifactLifecycleManager';
import {
  QUALITY_SCORE_OUTPUT_KEY,
  scoreStatically,
  type QualityScore,
} from './OutputQualityScorer';
import {
  buildConfidenceSignals,
  computeConfidence,
  CONFIDENCE_OUTPUT_KEY,
} from './ConfidenceScorer';
import { DEFAULT_CONFIDENCE_PAUSE_THRESHOLD } from './StagentSettingsDefaults';
import {
  buildHITLPolicy,
  shouldPauseAfterStage,
  type HITLPolicy,
} from './AdaptiveHITLPolicy';
import { isContractNode } from './HITLContractNodePolicy';
import type { ConfidenceResult } from './ConfidenceScorer';
import { buildQualityReportPayload } from './quality-report/buildQualityReportPayload';

type StageErrorMessage = Extract<BackendMessage, { type: 'stageError' }>;
export type StageStepOutcome = 'continue' | 'halt' | 'failed';

/** 与 stageError 同步写入 runtime.lastError，供重启恢复重放。 */
function persistStageLastError(runtime: StageRuntime, err: Omit<StageErrorMessage, 'type'>): void {
  runtime.lastError = {
    error: err.error,
    errorType: err.errorType,
    stdout: err.stdout,
    stderr: err.stderr,
  };
}

function postStageError(
  panel: PanelLike,
  postMessage: (panel: PanelLike, msg: BackendMessage) => void,
  runtime: StageRuntime,
  err: Omit<StageErrorMessage, 'type'>,
): void {
  persistStageLastError(runtime, err);
  postMessage(panel, { type: 'stageError', ...err });
}

/** 阶段终态失败：同步 stageError + stageStatus error + workflowFailed（与生成前失败 UI 一致）。 */
function failWorkflowStage(
  panel: PanelLike,
  postMessage: (panel: PanelLike, msg: BackendMessage) => void,
  runtime: StageRuntime,
  instance: WorkflowInstance,
  err: Omit<StageErrorMessage, 'type'>,
  scheduleSave: () => void,
): StageStepOutcome {
  runtime.status = 'error';
  instance.status = 'failed';
  postStageError(panel, postMessage, runtime, err);
  postMessage(panel, { type: 'stageStatusUpdate', stageId: err.stageId, status: 'error' });
  postMessage(panel, {
    type: 'workflowFailed',
    reason: err.error,
    errorType: err.errorType,
    stageId: err.stageId,
  });
  scheduleSave();
  return 'failed';
}

type CodeRunnerResult = { exitCode: number; stdout: string; stderr: string };
type PanelLike = unknown;

export function resolveWorkspaceFirstReadablePath(
  instanceKey: string,
  relativePath: string,
  workspacePath: string | undefined,
  resolveTaskFilePath: (instanceKey: string, relativePath: string) => string,
): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  if (workspacePath) {
    const wsPath = path.join(workspacePath, relativePath);
    if (fs.existsSync(wsPath)) {
      return wsPath;
    }
  }
  return resolveTaskFilePath(instanceKey, relativePath);
}

export interface NonLlmToolExecutionParams {
  stage: Stage;
  runtime: StageRuntime;
  outKey: string;
  instance: WorkflowInstance;
  instanceKey: string;
  resolveTaskFilePath: (instanceKey: string, relativePath: string) => string;
  /** file-write / path 解析：base 缺省为 instance（taskDir） */
  resolveOutputPath: (instanceKey: string, relativePath: string, base?: ToolPathBase) => string;
  resolveReadableFilePath?: (instanceKey: string, relativePath: string) => string;
  runCodeRunner: (
    cfg: CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
  ) => Promise<CodeRunnerResult>;
  /** 当前阶段在 definition.stages 中的线性下标（code-runner workflow lint） */
  stageIndex: number;
  trackPersistedFile?: ExecuteNextStageLoopParams['trackPersistedFile'];
}

export type { ExecuteNextStageLoopParams } from './WorkflowExecutorTypes';
import type { ExecuteNextStageLoopParams } from './WorkflowExecutorTypes';

export async function executeNonLlmTool(params: NonLlmToolExecutionParams): Promise<boolean> {
  const {
    stage,
    runtime,
    outKey,
    instance,
    instanceKey,
    resolveTaskFilePath,
    resolveOutputPath,
    resolveReadableFilePath,
    runCodeRunner,
    stageIndex,
    trackPersistedFile,
  } = params;

  if (stage.tool === 'file-write') {
    const cfg = stage.toolConfig as FileWriteConfig;
    if (!cfg.filePath?.trim()) {
      throw new Error(`invariant-violation:file-write missing filePath at ${stage.id}`);
    }
    if (!cfg.sourceOutputKey?.trim()) {
      throw new Error(`invariant-violation:file-write missing sourceOutputKey at ${stage.id}`);
    }
    const sourceRt = findFileWriteSourceRuntime(instance, cfg);
    if (!sourceRt) {
      throw new Error(
        `file-write source output not found: key=${cfg.sourceOutputKey}` +
          (cfg.sourceStageId ? ` stageId=${cfg.sourceStageId}` : ''),
      );
    }
    const content = String(sourceRt.outputs[cfg.sourceOutputKey] ?? '');
    if (!content.trim()) {
      throw new Error(
        `file-write empty content: stage=${stage.id} sourceKey=${cfg.sourceOutputKey} target=${cfg.filePath}`,
      );
    }
    const targetPath = resolveOutputPath(instanceKey, cfg.filePath, cfg.pathBase ?? DEFAULT_TOOL_PATH_BASE);
    const prior = readPriorFileContent(targetPath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
    trackPersistedFile?.({
      stageId: stage.id,
      outputKey: outKey,
      filePath: targetPath,
      content,
      existedBefore: prior.existedBefore,
      priorContent: prior.priorContent,
    });
    runtime.outputs[outKey] = targetPath;
    return true;
  }

  if (stage.tool === 'file-read') {
    const cfg = stage.toolConfig as FileReadConfig;
    if (!cfg.filePath?.trim()) {
      throw new Error(`invariant-violation:file-read missing filePath at ${stage.id}`);
    }
    const targetPath = resolveReadableFilePath
      ? resolveReadableFilePath(instanceKey, cfg.filePath)
      : resolveTaskFilePath(instanceKey, cfg.filePath);
    if (!fs.existsSync(targetPath)) {
      if (stage.id === 'stage_zoom_out') {
        const fallback = [
          '# moduleMap (fallback)',
          '',
          `- file-not-found: ${targetPath}`,
          '- zoom_out 使用了最小占位输出；后续决策阶段应提示用户补充模块上下文。',
        ].join('\n');
        runtime.outputs[outKey] = fallback;
        runtime.outputs.content = fallback;
        runtime.outputs._zoomOutFallback = true;
        return true;
      }
      throw new Error(`file-not-found:${targetPath}`);
    }
    const content = fs.readFileSync(targetPath, 'utf-8');
    runtime.outputs[outKey] = content;
    runtime.outputs.content = content;
    return true;
  }

  if (stage.tool === 'code-runner') {
    const cfg = stage.toolConfig as CodeRunnerConfig;
    if (!cfg.command?.trim()) {
      throw new Error(`invariant-violation:code-runner missing command at ${stage.id}`);
    }
    const issues = collectAllCodeRunnerLintIssues(String(cfg.command), instance.definition, stageIndex);
    if (issues.length > 0) {
      const first = issues[0];
      throw new Error(`invariant-violation:${formatCodeRunnerCommandIssue(stage.id, first)}`);
    }
    // 执行期配置键契约检查：读取磁盘上已生成的 config.*.yaml 与被调脚本，拦截跨阶段 config 键漂移，
    // 在运行前给出明确 fix 提示（而非让脚本跑到一半报 exitCode=1）。
    const contractWorkspaceDir = resolveOutputPath(instanceKey, cfg.workingDir?.trim() || '.', cfg.pathBase ?? 'workspace');
    const contractIssues = collectConfigContractIssuesOnDisk(String(cfg.command), contractWorkspaceDir);
    if (contractIssues.length > 0) {
      throw new Error(`invariant-violation:${contractIssues[0].message}`);
    }
    const result = await runCodeRunner(cfg, instanceKey, stage.id);
    runtime.outputs._exitCode = result.exitCode;
    runtime.outputs.stdout = result.stdout;
    runtime.outputs.stderr = result.stderr;
    runtime.outputs[outKey] = cfg.captureOutput
      ? [result.stdout, result.stderr].filter(Boolean).join('\n')
      : `exitCode=${result.exitCode}`;
    if (result.exitCode !== 0) {
      throw new Error(`tool-execution-failed: code-runner exitCode=${result.exitCode}`);
    }
    return true;
  }

  return false;
}

async function executeNextStageLoopLinear(params: ExecuteNextStageLoopParams): Promise<void> {
  const { instance, scheduleSave, debugLog, postMessage, panel } = params;
  const { definition, stageRuntimes } = instance;

  while (instance.currentStageIndex < definition.stages.length) {
    const idx = instance.currentStageIndex;
    const runtime = stageRuntimes[idx];

    if (runtime.status === 'done' || runtime.status === 'skipped') {
      instance.currentStageIndex++;
      continue;
    }
    if (runtime.status === 'paused') {
      return;
    }

    const outcome = await executeStageStep(params, idx);
    if (outcome === 'failed' || instance.status === 'failed') {
      return;
    }
    if (outcome === 'halt') {
      return;
    }

    instance.currentStageIndex++;
    scheduleSave();
  }

  await runPreRunEndContractLint(params);

  instance.status = 'completed';
  instance.completedAt = new Date().toISOString();
  debugLog('workflow', 'run_end', 0, { status: 'completed' });
  postMessage(panel, {
    type: 'workflowCompleted',
    qualityReport: buildQualityReportPayload(instance),
  });
  scheduleSave();
}

/** M21.1b / M24 / M26：run_end 前跑一次跨文件契约 + 测试质量 lint，warning 写入 debug 日志。 */
async function runPreRunEndContractLint(params: ExecuteNextStageLoopParams): Promise<void> {
  if (!params.preRunEndContractLint) {
    return;
  }
  try {
    const warnings = await params.preRunEndContractLint();
    if (warnings.length > 0) {
      params.debugLog('workflow', 'pre_run_end_contract_lint', 0, { warnings });
    }
  } catch (e) {
    params.debugLog('workflow', 'pre_run_end_contract_lint_error', 0, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 执行单个阶段（不修改 currentStageIndex）。 */
async function executeStageStep(
  params: ExecuteNextStageLoopParams,
  stageIndex: number,
): Promise<StageStepOutcome> {
  const {
    instance,
    panel,
    currentInstanceKey,
    setCurrentInstanceKey,
    evaluateSkipCondition,
    postMessage,
    scheduleSave,
    debugLog,
    debugLogLlmPreview,
    primaryOutputKey,
    ensureTaskDir,
    resolveInput,
    executeLlmText,
    applyPatchInstructions,
    resolveTaskFilePath,
    resolveOutputPath,
    resolveReadableFilePath,
    runCodeRunner,
    isCancellationError,
    logUserAction,
    trackPersistedFile,
    confidencePauseThreshold,
    hitlPolicy,
  } = params;

  const { definition, stageRuntimes } = instance;
  const stage = definition.stages[stageIndex];
  const runtime = stageRuntimes[stageIndex];

  if (stage.skipIf && evaluateSkipCondition(stage.skipIf, stageRuntimes)) {
    runtime.status = 'skipped';
    runtime.completedAt = new Date().toISOString();
    logUserAction?.('stage_skipped', {
      stageId: stage.id,
      condition: stage.skipIf,
    });
    postMessage(panel, { type: 'stageStatusUpdate', stageId: stage.id, status: 'skipped' });
    scheduleSave();
    return 'continue';
  }

  if (shouldEnterWaitingQuestions(stage.questionBefore, runtime.questionBeforeAnswers)) {
    runtime.status = 'waiting-questions';
    postMessage(panel, {
      type: 'stageStatusUpdate',
      stageId: stage.id,
      status: 'waiting-questions',
      isDecisionStage: stage.isDecisionStage,
    });
    postMessage(panel, {
      type: 'stageQuestionsBefore',
      stageId: stage.id,
      questions: stage.questionBefore ?? [],
    });
    scheduleSave();
    return 'halt';
  }

  if (stage.isDecisionStage && stage.tool !== 'llm-text') {
    return failWorkflowStage(panel, postMessage, runtime, instance, {
      stageId: stage.id,
      error: '不变式 I-1：决策阶段必须使用 llm-text',
      errorType: 'invariant-violation',
    }, scheduleSave);
  }

  const effectivePauseAfter = stage.isDecisionStage ? true : stage.pauseAfter;
  runtime.status = runtime.status === 'retrying' ? 'retrying' : 'running';
  runtime.startedAt = runtime.startedAt ?? new Date().toISOString();
  const attempt = runtime.retryCount + 1;
  debugLog(stage.id, 'stage_start', attempt, { tool: stage.tool, pauseAfter: effectivePauseAfter });
  debugLog(stage.id, 'tool_config_snapshot', attempt, stage.toolConfig);
  postMessage(panel, {
    type: 'stageStatusUpdate',
    stageId: stage.id,
    status: 'running',
    isDecisionStage: stage.isDecisionStage,
  });

  try {
    const outKey = primaryOutputKey(stage);
    const instanceKey = currentInstanceKey ?? crypto.randomUUID();
    setCurrentInstanceKey(instanceKey);
    ensureTaskDir(instanceKey);

    if (stage.tool === 'llm-text') {
      const tc = stage.toolConfig as {
        type: 'llm-text';
        systemPrompt: string;
        writeOutputToFile?: string;
        writePathBase?: ToolPathBase;
      };
      let sys = tc.systemPrompt;
      if (runtime.retryComment) {
        sys += `\n\n用户修改意见：${runtime.retryComment}`;
      }
      const userContent = await resolveInput(stage, runtime, panel);
      let text = '';
      if (/^stage_impl_/.test(stage.id)) {
        const guarded = await executeImplWithHollowGuard(sys, userContent, (nextSys, nextUser) =>
          executeLlmText(stage.id, nextSys, nextUser, panel),
        );
        text = guarded.text;
        if (guarded.note) {
          runtime.outputs._implExecNote = guarded.note;
        }
      } else {
        text = await executeLlmText(stage.id, sys, userContent, panel);
      }
      debugLogLlmPreview?.(stage.id, attempt, {
        chars: text.length,
        head: text.slice(0, 200),
        tail: text.slice(Math.max(0, text.length - 200)),
      });
      runtime.outputs[outKey] = text;

      if (!stage.patchMode && tc.writeOutputToFile) {
        const base: ToolPathBase = tc.writePathBase ?? DEFAULT_TOOL_PATH_BASE;
        const absPath = resolveOutputPath(instanceKey, tc.writeOutputToFile, base);
        const reuse = definition.meta.reuseStrategy ?? 'regenerate';
        const fileExists = fs.existsSync(absPath);
        const normalized = normalizeLlmOutputForWritePath(tc.writeOutputToFile, text);
        if (!normalized.ok) {
          return failWorkflowStage(panel, postMessage, runtime, instance, {
            stageId: stage.id,
            error: `writeOutputToFile: ${normalized.reason}`,
            errorType: 'llm-invalid-output',
            rawOutput: text.slice(0, 4000),
          }, scheduleSave);
        }
        const toWrite = normalized.content;

        if (fileExists && reuse === 'reuse-all') {
          const existing = fs.readFileSync(absPath, 'utf-8');
          runtime.outputs[outKey] = existing;
          debugLog(stage.id, 'writeOutputToFile_reuse_all', attempt, {
            path: absPath,
            chars: existing.length,
          });
          postMessage(panel, {
            type: 'stageOutputUpdate',
            stageId: stage.id,
            outputKey: outKey,
            content: existing,
          });
          postMessage(panel, {
            type: 'streamChunk',
            stageId: stage.id,
            chunk: `♻️ 复用已有文件（跳过写入）：${absPath}\n`,
          });
        } else {
          const prior = readPriorFileContent(absPath);
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, toWrite, 'utf-8');
          trackPersistedFile?.({
            stageId: stage.id,
            outputKey: outKey,
            filePath: absPath,
            content: toWrite,
            existedBefore: prior.existedBefore,
            priorContent: prior.priorContent,
          });
          debugLog(stage.id, 'writeOutputToFile_write', attempt, {
            path: absPath,
            chars: toWrite.length,
          });
          postMessage(panel, {
            type: 'stageOutputUpdate',
            stageId: stage.id,
            outputKey: outKey,
            content: toWrite,
          });
          postMessage(panel, {
            type: 'streamChunk',
            stageId: stage.id,
            chunk: `💾 代码已写入：${absPath}\n`,
          });
          runtime.outputs[outKey] = toWrite;
        }
      }

      if (stage.patchMode) {
        let instructions: PatchInstruction[];
        try {
          // #3：容错提取 —— 剥离 markdown 围栏 / 前后散文，取首个 JSON 数组（或对象）。
          // 浏览器网页 AI 常把数组包进 ```json 围栏或夹带解释，直接 JSON.parse 会失败。
          const jsonStr = extractJsonValue(text) ?? text;
          instructions = JSON.parse(jsonStr) as PatchInstruction[];
          if (!Array.isArray(instructions)) {
            throw new Error('patch instruction must be array');
          }
        } catch (e) {
          return failWorkflowStage(panel, postMessage, runtime, instance, {
            stageId: stage.id,
            error: `patchMode 输出不是合法 PatchInstruction[]：${String(e)}`,
            errorType: 'llm-invalid-output',
            rawOutput: text,
          }, scheduleSave);
        }
        await applyPatchInstructions(instanceKey, instructions, runtime, outKey);
      }

      const quality = scoreStatically(
        stage,
        String(runtime.outputs[outKey] ?? ''),
        definition,
      );
      runtime.outputs[QUALITY_SCORE_OUTPUT_KEY] = quality;
      const confidence = computeConfidence(
        buildConfidenceSignals(
          stage,
          runtime,
          outKey,
          String(runtime.outputs[outKey] ?? ''),
          quality,
        ),
      );
      runtime.outputs[CONFIDENCE_OUTPUT_KEY] = confidence;
      const pauseThreshold = confidencePauseThreshold ?? DEFAULT_CONFIDENCE_PAUSE_THRESHOLD;
      debugLog(stage.id, 'confidence_scored', attempt, {
        score: confidence.score,
        level: confidence.level,
        pauseThreshold,
        belowPauseThreshold: confidence.score < pauseThreshold,
      });
      postMessage(panel, {
        type: 'stageConfidenceUpdate',
        stageId: stage.id,
        score: confidence.score,
        level: confidence.level,
        reasons: confidence.reasons,
      });

      if (params.postImplStaticAnalysis && /^stage_impl_/.test(stage.id)) {
        try {
          const analysisWarnings = await params.postImplStaticAnalysis(stage);
          if (analysisWarnings.length > 0) {
            debugLog(stage.id, 'post_impl_static_analysis', attempt, {
              warnings: analysisWarnings,
            });
          }
        } catch (e) {
          debugLog(stage.id, 'post_impl_static_analysis_error', attempt, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else {
      const handled = await executeNonLlmTool({
        stage,
        runtime,
        outKey,
        instance,
        instanceKey,
        resolveTaskFilePath,
        resolveOutputPath,
        resolveReadableFilePath,
        runCodeRunner,
        stageIndex,
        trackPersistedFile,
      });
      if (!handled) {
        throw new Error(`工具 ${stage.tool} 尚未实现`);
      }
    }

    runtime.completedAt = new Date().toISOString();
    const policy = hitlPolicy ?? buildHITLPolicy({ confidencePauseThreshold });
    const confidenceResult = runtime.outputs[CONFIDENCE_OUTPUT_KEY] as ConfidenceResult | undefined;
    const shouldPause =
      stage.tool === 'llm-text' && confidenceResult && hitlPolicy
        ? shouldPauseAfterStage(stage, runtime, confidenceResult, policy, {
            // M21.4：契约节点（被 ≥2 下游引用 / 数据管道核心 impl）在置信度未达阈值时升级暂停。
            isContractNode: isContractNode(definition, stage),
          })
        : effectivePauseAfter;
    if (stage.tool === 'llm-text' && confidenceResult && hitlPolicy) {
      debugLog(stage.id, 'hitl_evaluated', attempt, {
        shouldPause,
        confidence: confidenceResult.score,
        pauseThreshold: policy.confidencePauseThreshold,
      });
    }
    runtime.status = shouldPause ? 'paused' : 'done';
    const qualityMeta = runtime.outputs[QUALITY_SCORE_OUTPUT_KEY] as QualityScore | undefined;
    const confidenceMeta = runtime.outputs[CONFIDENCE_OUTPUT_KEY] as { score?: number; level?: string } | undefined;
    debugLog(stage.id, 'stage_end', attempt, {
      status: runtime.status,
      outputKey: outKey,
      ...(qualityMeta?.overall !== undefined ? { qualityOverall: qualityMeta.overall } : {}),
      ...(confidenceMeta?.score !== undefined
        ? { confidenceScore: confidenceMeta.score, confidenceLevel: confidenceMeta.level }
        : {}),
    });

    postMessage(panel, {
      type: 'stageOutputUpdate',
      stageId: stage.id,
      outputKey: outKey,
      content: runtime.outputs[outKey],
    });
    postMessage(panel, {
      type: 'stageStatusUpdate',
      stageId: stage.id,
      status: runtime.status,
      isDecisionStage: stage.isDecisionStage,
    });

    if (runtime.status === 'paused') {
      if (stage.questionAfter?.length) {
        postMessage(panel, {
          type: 'stageQuestions',
          stageId: stage.id,
          questions: stage.questionAfter,
        });
      }
      scheduleSave();
      return 'halt';
    }

    return 'continue';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'llm-context-overflow') {
      return failWorkflowStage(panel, postMessage, runtime, instance, {
        stageId: stage.id,
        error: 'LLM 上下文溢出',
        errorType: 'llm-context-overflow',
      }, scheduleSave);
    }

    const cancelled = isCancellationError(e) || (e instanceof Error && /cancel/i.test(e.message));
    const timeout = e instanceof Error && e.message.includes('code-runner-timeout');
    const fileNotFound = e instanceof Error && e.message.startsWith('file-not-found:');
    const stageNotFound = e instanceof Error && e.message.startsWith('stage-not-found:');
    const implHollow = e instanceof Error && e.message.startsWith('impl-hollow-output');
    const invariantViolation = e instanceof Error && e.message.startsWith('invariant-violation:');
    if (implHollow) {
      runtime.outputs._implExecNote = '实现阶段输出连续两次为空洞确认语句，已终止阶段，请检查该阶段 systemPrompt。';
    }
    runtime.status = 'error';
    const errorType = timeout
      ? 'code-runner-timeout'
      : fileNotFound
        ? 'file-not-found'
        : stageNotFound
          ? 'stage-not-found'
          : invariantViolation
            ? 'invariant-violation'
            : implHollow
              ? 'llm-invalid-output'
              : cancelled
                ? 'llm-timeout'
                : 'tool-execution-failed';
    const errPayload = {
      stageId: stage.id,
      error: implHollow
        ? '实现阶段输出为空洞确认语句（自动重试后仍失败）'
        : invariantViolation
          ? msg.replace('invariant-violation:', '')
          : msg,
      errorType,
    } as Omit<StageErrorMessage, 'type'>;
    if (errorType === 'tool-execution-failed' || errorType === 'code-runner-timeout') {
      const so = runtime.outputs.stdout;
      const se = runtime.outputs.stderr;
      if (typeof so === 'string' && so.length > 0) {
        errPayload.stdout = so;
      }
      if (typeof se === 'string' && se.length > 0) {
        errPayload.stderr = se;
      }
    }
    return failWorkflowStage(panel, postMessage, runtime, instance, errPayload, scheduleSave);
  }
}

async function executeNextStageLoopDag(params: ExecuteNextStageLoopParams): Promise<void> {
  const { instance, definition, stageRuntimes } = {
    instance: params.instance,
    definition: params.instance.definition,
    stageRuntimes: params.instance.stageRuntimes,
  };
  const maxParallel = params.dagMaxParallelism ?? 1;

  while (true) {
    const pausedIdx = stageRuntimes.findIndex((rt) => rt.status === 'paused' || rt.status === 'waiting-questions');
    if (pausedIdx >= 0) {
      instance.currentStageIndex = pausedIdx;
      return;
    }

    const runningIdx = stageRuntimes.findIndex((rt) => rt.status === 'running' || rt.status === 'retrying');
    if (runningIdx >= 0) {
      instance.currentStageIndex = runningIdx;
      return;
    }

    const allTerminal = stageRuntimes.every((rt) => rt.status === 'done' || rt.status === 'skipped');
    if (allTerminal) {
      await runPreRunEndContractLint(params);
      instance.status = 'completed';
      instance.completedAt = new Date().toISOString();
      params.debugLog('workflow', 'run_end', 0, { status: 'completed', mode: 'dag', maxParallel });
      params.postMessage(params.panel, {
        type: 'workflowCompleted',
        qualityReport: buildQualityReportPayload(instance),
      });
      params.scheduleSave();
      return;
    }

    const batch = pickDagExecutionBatch(definition.stages, stageRuntimes, maxParallel);
    if (batch.length === 0) {
      const pendingIdx = stageRuntimes.findIndex((rt) => rt.status === 'pending');
      if (pendingIdx >= 0) {
        const stageId = definition.stages[pendingIdx].id;
        failWorkflowStage(
          params.panel,
          params.postMessage,
          stageRuntimes[pendingIdx],
          instance,
          {
            stageId,
            error: 'DAG 调度无法找到可执行节点（可能存在循环依赖或未满足依赖）',
            errorType: 'invariant-violation',
          },
          params.scheduleSave,
        );
      }
      return;
    }

    instance.currentStageIndex = batch[0];

    if (batch.length === 1) {
      const outcome = await executeStageStep(params, batch[0]);
      params.scheduleSave();
      if (outcome === 'failed' || instance.status === 'failed') {
        return;
      }
      if (outcome === 'halt') {
        syncDagCurrentStageIndex(instance);
        return;
      }
      continue;
    }

    const stageIds = batch.map((i) => definition.stages[i].id);
    const waveIndex = params.onDagParallelWaveStart?.(stageIds);
    params.debugLog('workflow', 'dag_parallel_wave', 0, {
      mode: 'dag',
      maxParallel,
      stageIds,
      waveIndex,
    });
    const outcomes = await Promise.all(batch.map((idx) => executeStageStep(params, idx)));
    if (waveIndex !== undefined) {
      const payload = params.onDagParallelWaveComplete?.(waveIndex) ?? {};
      params.debugLog('workflow', 'dag_parallel_wave_complete', 0, payload);
    }
    params.scheduleSave();
    if (outcomes.some((o) => o === 'failed') || instance.status === 'failed') {
      return;
    }
    if (outcomes.some((o) => o === 'halt')) {
      syncDagCurrentStageIndex(instance);
      return;
    }
  }
}

function findStageRuntimeByOutputKey(instance: WorkflowInstance, outputKey: string): StageRuntime | undefined {
  for (let i = 0; i < instance.definition.stages.length; i++) {
    const rt = instance.stageRuntimes[i];
    if (rt?.outputs[outputKey] !== undefined) {
      return rt;
    }
  }
  return undefined;
}

export { executeNextStageLoop } from './engine-wiring/coreExecutionBridge';

function findFileWriteSourceRuntime(instance: WorkflowInstance, cfg: FileWriteConfig): StageRuntime | undefined {
  if (cfg.sourceStageId?.trim()) {
    const idx = instance.definition.stages.findIndex((s) => s.id === cfg.sourceStageId);
    if (idx < 0) {
      return undefined;
    }
    return instance.stageRuntimes[idx];
  }
  return findStageRuntimeByOutputKey(instance, cfg.sourceOutputKey);
}
