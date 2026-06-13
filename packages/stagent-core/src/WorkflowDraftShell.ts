/**
 * M41：预执行草稿壳 — 润色/澄清/生成入口的 idle 实例生命周期。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import { uiMsg } from './l10n/uiStrings';
import { PRE_EXEC_SHELL_INSTANCE_PREFIX_CHARS, WORKFLOW_META_TITLE_MAX } from './LogPreviewLimits';
import { isStagentInstanceStateDir } from './paths/StagentInstancePathGuards';
import { taskDebugLogPath, taskInstanceDir } from './paths/StagentPaths';
import { resolvePreExecTaskDir } from './WorkflowPathResolver';
import {
  DEBUG_EVENT_PRE_EXEC_SHELL_CREATED,
  DEBUG_EVENT_TASK_DIR_REBOUND,
} from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';

export interface DraftShellState {
  currentInstanceKey?: string;
  instance?: WorkflowInstance;
}

export interface DraftShellDeps {
  getState: () => DraftShellState;
  setActive: (key: string, instance: WorkflowInstance) => void;
  clearActive: () => void;
  resolveExistingDirectoryPath: (
    raw: string,
  ) => { ok: true; abs: string } | { ok: false; reason: string };
  workspaceFolderPath: () => string | undefined;
  globalStorageFsPath: string;
  getDefaultTaskDir: (instanceId: string) => string;
  resolveInitialTaskDirForStart: (
    instanceId: string,
    wf: WorkflowDefinition,
  ) => { ok: true; dir: string } | { ok: false; reason: string };
  scheduleSave: () => void;
  persistMilestone: () => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  warn: (message: string) => void;
  deleteInstanceRecord: (instanceKey: string) => void;
  clearExperiencePersistedFlag: () => void;
}

export function rebindTaskDirIfNeeded(deps: DraftShellDeps, taskWorkspacePathRaw: string): void {
  const { currentInstanceKey, instance } = deps.getState();
  if (!instance || !currentInstanceKey) {
    return;
  }
  const wsRes = deps.resolveExistingDirectoryPath(taskWorkspacePathRaw);
  if (!wsRes.ok) {
    return;
  }
  const targetDir = taskInstanceDir(wsRes.abs, currentInstanceKey);
  const currentDir = instance.taskDir ?? deps.getDefaultTaskDir(currentInstanceKey);
  if (path.resolve(currentDir) === path.resolve(targetDir)) {
    instance.definition.meta = {
      ...instance.definition.meta,
      taskWorkspacePath: wsRes.abs,
    };
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const oldLog = taskDebugLogPath(currentDir);
  const newLog = taskDebugLogPath(targetDir);
  if (fs.existsSync(oldLog)) {
    fs.appendFileSync(newLog, fs.readFileSync(oldLog, 'utf-8'), 'utf-8');
  }

  instance.taskDir = targetDir;
  instance.definition.meta = {
    ...instance.definition.meta,
    taskWorkspacePath: wsRes.abs,
  };
  deps.scheduleSave();
  deps.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_TASK_DIR_REBOUND, 0, { from: currentDir, to: targetDir });

  try {
    if (isStagentInstanceStateDir(currentDir)) {
      fs.rmSync(currentDir, { recursive: true, force: true });
    }
  } catch (e) {
    deps.warn(`task_dir_rebound_rm_old_failed err=${String(e)}`);
  }
}

/**
 * 方案 A：润色/澄清/生成入口即建 idle 预执行壳（stages 为空），全程 debug 写入同一 taskDir。
 */
export function ensurePreExecDraftShell(
  deps: DraftShellDeps,
  opts: {
    phase: 'polish' | 'clarify' | 'generate';
    userInput?: string;
    taskType: string;
    taskWorkspacePathRaw?: string;
  },
): string | undefined {
  const { phase, userInput, taskType, taskWorkspacePathRaw } = opts;
  const { currentInstanceKey, instance } = deps.getState();

  if (currentInstanceKey && instance?.status === 'idle' && instance.definition.stages.length === 0) {
    const meta = instance.definition.meta ?? {};
    const wsAbs = taskWorkspacePathRaw?.trim()
      ? (() => {
          const res = deps.resolveExistingDirectoryPath(taskWorkspacePathRaw.trim());
          return res.ok ? res.abs : undefined;
        })()
      : undefined;
    instance.definition.meta = {
      ...meta,
      ...(userInput?.trim() ? { userInput: userInput.trim() } : {}),
      taskType,
      ...(wsAbs ? { taskWorkspacePath: wsAbs } : {}),
    };
    if (taskWorkspacePathRaw?.trim()) {
      rebindTaskDirIfNeeded(deps, taskWorkspacePathRaw.trim());
    }
    deps.scheduleSave();
    return currentInstanceKey;
  }

  if (currentInstanceKey && instance?.status === 'idle' && instance.definition.stages.length > 0) {
    deps.deleteInstanceRecord(currentInstanceKey);
  }

  const instanceId = crypto.randomUUID();
  const taskWorkspaceAbs = taskWorkspacePathRaw?.trim()
    ? (() => {
        const res = deps.resolveExistingDirectoryPath(taskWorkspacePathRaw.trim());
        return res.ok ? res.abs : undefined;
      })()
    : undefined;

  const placeholderWf = {
    id: `pre-exec-${instanceId.slice(0, PRE_EXEC_SHELL_INSTANCE_PREFIX_CHARS)}`,
    version: '2.0' as const,
    meta: {
      title: userInput?.trim().slice(0, WORKFLOW_META_TITLE_MAX) || uiMsg('stagent.meta.preExecDraftTitle'),
      userInput: userInput?.trim() ?? '',
      taskType,
      createdAt: new Date().toISOString(),
      ...(taskWorkspaceAbs ? { taskWorkspacePath: taskWorkspaceAbs } : {}),
    },
    stages: [],
  };

  const dirRes = resolvePreExecTaskDir(
    instanceId,
    taskWorkspacePathRaw,
    deps.workspaceFolderPath(),
    deps.globalStorageFsPath,
  );
  if (!dirRes.ok) {
    deps.warn(`pre_exec_shell_resolve_dir_failed reason=${dirRes.reason}`);
    return undefined;
  }

  const shell: WorkflowInstance = {
    traceId: `trace_${crypto.randomUUID()}`,
    definition: placeholderWf,
    currentStageIndex: 0,
    stageRuntimes: [],
    status: 'idle',
    taskDir: dirRes.dir,
  };
  deps.setActive(instanceId, shell);
  deps.clearExperiencePersistedFlag();
  fs.mkdirSync(dirRes.dir, { recursive: true });
  deps.persistMilestone();
  deps.scheduleSave();
  deps.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_PRE_EXEC_SHELL_CREATED, 0, { phase, taskDir: dirRes.dir });
  return instanceId;
}

function persistDraftInstance(deps: DraftShellDeps, wf: WorkflowDefinition): string | undefined {
  const { currentInstanceKey, instance } = deps.getState();
  if (currentInstanceKey && instance?.status === 'idle') {
    deps.deleteInstanceRecord(currentInstanceKey);
  }
  const instanceId = crypto.randomUUID();
  const taskDirRes = deps.resolveInitialTaskDirForStart(instanceId, wf);
  if (!taskDirRes.ok) {
    deps.warn(`persist_draft_instance_resolve_dir_failed reason=${taskDirRes.reason}`);
    return undefined;
  }
  const draft: WorkflowInstance = {
    traceId: `trace_${crypto.randomUUID()}`,
    definition: wf,
    currentStageIndex: 0,
    stageRuntimes: wf.stages.map((s) => ({
      stageId: s.id,
      status: 'pending' as const,
      outputs: {},
      retryCount: 0,
    })),
    status: 'idle',
    taskDir: taskDirRes.dir,
  };
  deps.setActive(instanceId, draft);
  deps.clearExperiencePersistedFlag();
  deps.persistMilestone();
  deps.scheduleSave();
  return instanceId;
}

export function finalizeDraftDefinition(deps: DraftShellDeps, wf: WorkflowDefinition): string | undefined {
  const { currentInstanceKey, instance } = deps.getState();
  const isPreExecShell =
    currentInstanceKey && instance?.status === 'idle' && instance.definition.stages.length === 0;

  if (isPreExecShell) {
    const key = currentInstanceKey!;
    const traceId = instance!.traceId;
    const priorTaskDir = instance!.taskDir;
    if (wf.meta?.taskWorkspacePath?.trim()) {
      rebindTaskDirIfNeeded(deps, wf.meta.taskWorkspacePath);
    }
    const { instance: rebound } = deps.getState();
    const next: WorkflowInstance = {
      traceId,
      definition: wf,
      currentStageIndex: 0,
      stageRuntimes: wf.stages.map((s) => ({
        stageId: s.id,
        status: 'pending',
        outputs: {},
        retryCount: 0,
      })),
      status: 'idle',
      taskDir: rebound?.taskDir ?? priorTaskDir,
    };
    deps.setActive(key, next);
    deps.clearExperiencePersistedFlag();
    deps.persistMilestone();
    deps.scheduleSave();
    return key;
  }

  return persistDraftInstance(deps, wf);
}
