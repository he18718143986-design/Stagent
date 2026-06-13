/**
 * M38.2：test_run 命令策略 — 拆分「依赖安装 && 测试执行」复合 command。
 *
 * 背景：单条 `npm install && npx jest …` 继承安装类 300s 超时底限，且失败时难以区分
 * 是安装还是测试出错。normalize 将 install 拆到独立 `stage_deps_install_*` 阶段。
 */
import { isTestRunStageId, semanticNameFromTestRunStageId } from './workflow/StageIdPatterns';
import { isCodeRunnerTool, STAGE_TOOL_CODE_RUNNER } from './workflow/StageToolKinds';
import type { CodeRunnerConfig, Stage, WorkflowDefinition } from './WorkflowDefinition';
import { isJsTestRunCommand, isPythonOnlyTestRunCommand } from './PlanCompletenessGate';
import {
  commandLooksLikeDependencyInstallSegment,
  commandLooksLikeTestRunSegment,
} from './workflow/CodeRunnerCommandSemantics';

export interface BundledInstallTestSplit {
  install: string;
  test: string;
}

const CD_SEGMENT = /^cd\s+/i;

function splitCommandSegments(command: string): string[] {
  return command
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isCdSegment(segment: string): boolean {
  return CD_SEGMENT.test(segment);
}

export function isDependencyInstallSegment(segment: string): boolean {
  return commandLooksLikeDependencyInstallSegment(segment);
}

export function isTestRunSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) {
    return false;
  }
  if (isJsTestRunCommand(trimmed) || isPythonOnlyTestRunCommand(trimmed)) {
    return true;
  }
  return commandLooksLikeTestRunSegment(trimmed);
}

/** 检测 command 是否在同一条里串联了依赖安装与测试执行。 */
export function commandBundlesInstallAndTest(command: string): boolean {
  return splitBundledInstallAndTestCommand(command) != null;
}

/**
 * 将 `cd … && npm install && npx jest` 拆为 install / test 两段；
 *  leading `cd` 段会复制到两侧以保持 cwd 语义。
 */
export function splitBundledInstallAndTestCommand(command: string): BundledInstallTestSplit | null {
  const segments = splitCommandSegments(command);
  if (segments.length < 2) {
    return null;
  }

  const cdPrefix: string[] = [];
  let i = 0;
  while (i < segments.length && isCdSegment(segments[i]!)) {
    cdPrefix.push(segments[i]!);
    i += 1;
  }

  const installSegs: string[] = [];
  while (i < segments.length && isDependencyInstallSegment(segments[i]!)) {
    installSegs.push(segments[i]!);
    i += 1;
  }
  if (installSegs.length === 0 || i >= segments.length) {
    return null;
  }

  const testSegs = segments.slice(i);
  if (!testSegs.some(isTestRunSegment)) {
    return null;
  }

  const prefix = cdPrefix.length > 0 ? `${cdPrefix.join(' && ')} && ` : '';
  return {
    install: `${prefix}${installSegs.join(' && ')}`.trim(),
    test: `${prefix}${testSegs.join(' && ')}`.trim(),
  };
}

export function deriveDepsInstallStageId(testRunStageId: string): string {
  const suffix = semanticNameFromTestRunStageId(testRunStageId)?.trim() || 'deps';
  return `stage_deps_install_${suffix}`;
}

function cloneStageForDepsInstall(template: Stage, id: string, installCommand: string): Stage {
  const prev = template.toolConfig as CodeRunnerConfig;
  const toolConfig: CodeRunnerConfig = {
    type: STAGE_TOOL_CODE_RUNNER,
    command: installCommand,
    captureOutput: prev.captureOutput ?? true,
    ...(prev.workingDir ? { workingDir: prev.workingDir } : {}),
    ...(prev.pathBase ? { pathBase: prev.pathBase } : {}),
  };
  return {
    id,
    title: `Install dependencies (${id.replace(/^stage_deps_install_/, '')})`,
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig,
    input: {
      sources: [...(template.input?.sources ?? [])],
      mergeStrategy: template.input?.mergeStrategy ?? 'concat',
    },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...(template.skipIf ? { skipIf: template.skipIf } : {}),
  };
}

/** 对工作流中所有 `stage_test_run_*` 的 install+test 复合 command 做 in-place 拆分。返回拆分次数。 */
export function splitBundledTestRunCommands(wf: WorkflowDefinition): number {
  const stages = wf.stages ?? [];
  let splitCount = 0;

  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const stage = stages[i]!;
    if (!isTestRunStageId(stage.id) || !isCodeRunnerTool(stage.tool)) {
      continue;
    }
    const cfg = stage.toolConfig as CodeRunnerConfig;
    const cmd = cfg.command?.trim();
    if (!cmd) {
      continue;
    }
    const split = splitBundledInstallAndTestCommand(cmd);
    if (!split) {
      continue;
    }

    cfg.command = split.test;
    delete cfg.timeout;

    const depsId = deriveDepsInstallStageId(stage.id);
    const existing = stages.find((s) => s.id === depsId);
    if (existing && isCodeRunnerTool(existing.tool)) {
      splitCount += 1;
      continue;
    }

    stages.splice(i, 0, cloneStageForDepsInstall(stage, depsId, split.install));
    splitCount += 1;
  }

  return splitCount;
}

export function detectBundledInstallAndTestRunIssue(command: string): {
  code: 'bundled-install-and-test-run';
  message: string;
} | null {
  if (!commandBundlesInstallAndTest(command)) {
    return null;
  }
  return {
    code: 'bundled-install-and-test-run',
    message:
      '同一条 command 串联了依赖安装（npm/pip install 等）与测试执行（jest/npm test/pytest）。请拆成独立的依赖安装阶段与 test_run，避免安装占满超时且失败语义不清。生成 normalize 可自动拆分（stagent.execution.splitTestRunBundledCommands，默认 true）。',
  };
}

export interface BundledVenvPipImportSplit {
  create: string;
  pip: string;
  importCheck: string;
}

const VENV_CREATE_SEGMENT = /python3?\s+-m\s+venv/i;
const VENV_PIP_SEGMENT = /\.venv\/bin\/python\s+-m\s+pip\s+install|pip3?\s+install.*requirements\.txt/i;
const VENV_IMPORT_CHECK_SEGMENT = /\.venv\/bin\/python\s+-c\s+.*\bimport\b/i;

function isVenvCreateSegment(segment: string): boolean {
  return VENV_CREATE_SEGMENT.test(segment);
}

function isVenvPipSegment(segment: string): boolean {
  return VENV_PIP_SEGMENT.test(segment) || (/\bpip3?\s+install\b/i.test(segment) && /\brequirements\.txt\b/i.test(segment));
}

function isVenvImportCheckSegment(segment: string): boolean {
  return VENV_IMPORT_CHECK_SEGMENT.test(segment);
}

/**
 * 将 `python3 -m venv .venv && pip install && python -c "import …"` 拆为三阶段。
 */
export function splitBundledVenvPipImportCommand(command: string): BundledVenvPipImportSplit | null {
  const segments = splitCommandSegments(command);
  if (segments.length < 3) {
    return null;
  }

  const cdPrefix: string[] = [];
  let i = 0;
  while (i < segments.length && isCdSegment(segments[i]!)) {
    cdPrefix.push(segments[i]!);
    i += 1;
  }

  const createSegs: string[] = [];
  while (i < segments.length && isVenvCreateSegment(segments[i]!)) {
    createSegs.push(segments[i]!);
    i += 1;
  }
  if (createSegs.length === 0) {
    return null;
  }

  const pipSegs: string[] = [];
  while (i < segments.length && isVenvPipSegment(segments[i]!)) {
    pipSegs.push(segments[i]!);
    i += 1;
  }
  if (pipSegs.length === 0) {
    return null;
  }

  const importSegs: string[] = [];
  while (i < segments.length && isVenvImportCheckSegment(segments[i]!)) {
    importSegs.push(segments[i]!);
    i += 1;
  }
  if (importSegs.length === 0 || i < segments.length) {
    return null;
  }

  const prefix = cdPrefix.length > 0 ? `${cdPrefix.join(' && ')} && ` : '';
  return {
    create: `${prefix}${createSegs.join(' && ')}`.trim(),
    pip: `${prefix}${pipSegs.join(' && ')}`.trim(),
    importCheck: `${prefix}${importSegs.join(' && ')}`.trim(),
  };
}

function cloneVenvStage(template: Stage, id: string, title: string, command: string): Stage {
  const prev = template.toolConfig as CodeRunnerConfig;
  const toolConfig: CodeRunnerConfig = {
    type: STAGE_TOOL_CODE_RUNNER,
    command,
    captureOutput: prev.captureOutput ?? true,
    ...(prev.workingDir ? { workingDir: prev.workingDir } : {}),
    ...(prev.pathBase ? { pathBase: prev.pathBase } : {}),
  };
  return {
    id,
    title,
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig,
    input: {
      sources: [...(template.input?.sources ?? [])],
      mergeStrategy: template.input?.mergeStrategy ?? 'concat',
    },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...(template.skipIf ? { skipIf: template.skipIf } : {}),
  };
}

/** 对工作流中合并的 venv+pip+import 链做 in-place 拆分。返回拆分次数。 */
export function splitBundledVenvPipImportCommands(wf: WorkflowDefinition): number {
  const stages = wf.stages ?? [];
  let splitCount = 0;

  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const stage = stages[i]!;
    if (!isCodeRunnerTool(stage.tool)) {
      continue;
    }
    const cfg = stage.toolConfig as CodeRunnerConfig;
    const cmd = cfg.command?.trim();
    if (!cmd) {
      continue;
    }
    const split = splitBundledVenvPipImportCommand(cmd);
    if (!split) {
      continue;
    }

    const baseId = stage.id.replace(/^stage_/, '').replace(/_init$/, '') || 'venv';
    const createId = stage.id.includes('venv') ? 'stage_venv_create' : `stage_venv_create_${baseId}`;
    const pipId = 'stage_venv_pip_install';
    const importId = 'stage_venv_import_check';

    if (hasStage(stages, createId) && hasStage(stages, pipId) && hasStage(stages, importId)) {
      stages.splice(i, 1);
      splitCount += 1;
      continue;
    }

    const createStage = cloneVenvStage(stage, createId, 'Create Python venv', split.create);
    const pipStage = cloneVenvStage(stage, pipId, 'Install Python dependencies', split.pip);
    const importStage = cloneVenvStage(stage, importId, 'Verify Python imports', split.importCheck);
    pipStage.dependsOn = [createId];
    importStage.dependsOn = [pipId];

    stages.splice(i, 1, createStage, pipStage, importStage);
    splitCount += 1;
  }

  return splitCount;
}

function hasStage(stages: Stage[], id: string): boolean {
  return stages.some((s) => s.id === id);
}
