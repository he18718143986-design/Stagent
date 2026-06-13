/**
 * pre-stage 阶段内置 QualityGate（从 BuiltinQualityGates.ts 抽出，1.3）。
 */
import * as path from 'path';
import type { QualityGate } from '../QualityGate';
import { readBlockDeliveryOnTestFailure } from '../execution/DeliveryBlockOnTestFailure';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { isDebugTaskType, isSoftwareTaskType } from '../workflow/TaskType';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { evaluateDebugFeedbackLoopGate } from '../DebugFeedbackLoopGate';
import { applyRedGreenFsmResult, evaluateImplRedConfirmResult, planImplRedFsm } from '../RedGreenFsm';
import { detectCrossSliceBleeding } from '../RedGreenCrossSlice';
import { interpretRedFromExitCode } from '../RedGreenGate';
import { gateMsg } from '../l10n/gateMsg';
import { lintTestRunPreflightOnDisk } from '../TestRunPreflight';
import {
  buildAutoNpmInstallConfig,
  resolveTestRunEffectiveCwd,
  shouldAutoNpmInstallBeforeTestRun,
} from '../TestRunAutoDepsInstall';
import {
  buildVenvCreateRunnerConfig,
  buildVenvPipRunnerConfig,
  requirementsTxtOnDisk,
  venvPythonExists,
} from '../python-bootstrap/autoVenvBootstrap';
import {
  GATE_ID_DEBUG_FEEDBACK_LOOP,
  GATE_ID_PYTHON_DECLARED_DEPS_PRE_TEST_RUN,
  GATE_ID_PYTHON_PIP_RESYNC,
  GATE_ID_PYTHON_REQUIREMENTS_MERGE,
  GATE_ID_PYTHON_VENV_BOOTSTRAP,
  GATE_ID_RED_GREEN_PRE_IMPL,
  GATE_ID_PYTHON_EXPORT_CONTRACT,
  GATE_ID_PYTHON_PYPI_SYMBOL,
  GATE_ID_REQUIREMENTS_TXT_PREFLIGHT,
  GATE_ID_SDK_PATH_CONTRACT_HARD,
  GATE_ID_TEST_RUN_CONTRACT_LINT,
  GATE_ID_TEST_RUN_DEPS_INSTALL,
  GATE_ID_SMOKE_DATA_BOOTSTRAP,
  GATE_ID_TEST_RUN_PREFLIGHT,
} from '../QualityGateIds';
import { SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import { seedSmokeCsvFixtures } from '../disk-bootstrap/smokeDataBootstrap';
import {
  collectAllProjectModuleNamesFromInstance,
  collectDeclaredDependenciesFromInstance,
  toPipInstallableDependencies,
} from '../commitment/decisionArtifactsSchema';
import { collectWorkflowArtifacts } from '../WorkflowArtifactRegistry';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { lintDeclaredDependenciesInFiles } from '../python-contract/PythonDeclaredDependenciesLint';
import {
  mergeDeclaredDependenciesIntoRequirements,
  pruneUndeclaredRequirements,
  requirementsContentHash,
} from '../python-contract/requirementsMerge';
import { preflightRequirementsTxtForPipInstall, stageInstallsRequirementsTxt } from '../RequirementsTxtPreflight';
import { block, isImplStage, isTestRunStage, warn } from './gateHelpers';
import { IMPL_WRITE_SCOPE_GATE } from './implWriteScopeGate';
import { semanticNameFromTestRunStageId } from '../workflow/StageIdPatterns';

export const BUILTIN_PRE_STAGE_GATES: QualityGate[] = [
  {
    id: GATE_ID_DEBUG_FEEDBACK_LOOP,
    label: 'Debug 反馈回路优先（I-26）',
    phase: 'pre-stage',
    priority: 10,
    when: 'always',
    enabled: (ctx) => !!ctx.stage && !!ctx.instance && isDebugTaskType(ctx.instance.definition.meta.taskType),
    evaluate(ctx) {
      const evaluation = evaluateDebugFeedbackLoopGate({
        workflow: ctx.instance!.definition,
        stage: ctx.stage!,
        stageIndex: ctx.stageIndex ?? 0,
        stageRuntimes: ctx.instance!.stageRuntimes,
        requireHard: ctx.executionHost?.readDebugFeedbackLoopRuntimeHard() ?? false,
      });
      if (!evaluation || evaluation.outcome === 'pass') {
        return null;
      }
      const severity = evaluation.outcome === 'block' ? 'block' : 'warn';
      return { gateId: GATE_ID_DEBUG_FEEDBACK_LOOP, severity, messages: [evaluation.reason] };
    },
  },
  {
    id: GATE_ID_RED_GREEN_PRE_IMPL,
    label: '红绿门（I-25）配对测试 RED 确认',
    phase: 'pre-stage',
    priority: 20,
    when: 'before-impl',
    enabled: (ctx) => isImplStage(ctx.stage) && !!ctx.stage && isLlmTextTool(ctx.stage.tool),
    async evaluate(ctx) {
      const host = ctx.executionHost;
      const stage = ctx.stage!;
      const instance = ctx.instance!;
      const runtime = ctx.stageRuntime;
      if (!host || !runtime) {
        return null;
      }
      let mode = host.readRedGreenGateMode();
      const taskType = instance.definition.meta?.taskType ?? '';
      if (
        mode === 'warn' &&
        isSoftwareTaskType(taskType) &&
        readBlockDeliveryOnTestFailure(getStagentConfiguration(), taskType)
      ) {
        mode = 'hard';
      }
      const plan = planImplRedFsm(stage, instance.definition, mode, runtime);
      if (plan.skipRunAlreadyConfirmed) {
        return null;
      }
      if (plan.phase !== 'run-paired-test' || !plan.pairedStage) {
        return null;
      }
      const pairedCfg = plan.pairedStage.toolConfig;
      if (pairedCfg.type !== 'code-runner') {
        return null;
      }
      const instanceKey = ctx.instanceKey ?? instance.definition.id;
      const bleeding = detectCrossSliceBleeding({
        workflow: instance.definition,
        stageRuntimes: instance.stageRuntimes,
        implStage: stage,
      });
      let evaluation;
      let crossSlicePass = false;
      try {
        const res = await host.runCodeRunner(pairedCfg, instanceKey, plan.pairedStage.id);
        if (!interpretRedFromExitCode(res.exitCode) && bleeding.bleeding) {
          crossSlicePass = true;
          evaluation = {
            outcome: 'pass' as const,
            reason: gateMsg('redGreen.crossSliceAlreadyGreen', bleeding.priorImplStageId ?? ''),
          };
        } else {
          evaluation = evaluateImplRedConfirmResult({ mode, exitCode: res.exitCode, threw: false });
        }
      } catch {
        evaluation = evaluateImplRedConfirmResult({ mode, exitCode: 1, threw: true });
      }
      applyRedGreenFsmResult(runtime, stage.id, evaluation);
      if (evaluation.outcome === 'pass') {
        if (crossSlicePass) {
          return {
            gateId: GATE_ID_RED_GREEN_PRE_IMPL,
            severity: 'warn',
            messages: [evaluation.reason],
          };
        }
        return null;
      }
      return {
        gateId: GATE_ID_RED_GREEN_PRE_IMPL,
        severity: evaluation.outcome === 'block' ? 'block' : 'warn',
        messages: [evaluation.reason],
      };
    },
  },
  IMPL_WRITE_SCOPE_GATE,
  {
    id: GATE_ID_PYTHON_VENV_BOOTSTRAP,
    label: 'Python venv 自动创建（import_check / .venv 命令前）',
    phase: 'pre-stage',
    priority: 15,
    when: 'always',
    enabled: (ctx) => {
      const stage = ctx.stage;
      if (!stage || stage.tool !== 'code-runner') {
        return false;
      }
      const cmd = (stage.toolConfig as { command?: string }).command ?? '';
      return stage.id === 'stage_venv_import_check' || /\.venv\/bin\/python/.test(cmd);
    },
    async evaluate(ctx) {
      const host = ctx.executionHost;
      const stage = ctx.stage!;
      const instanceKey = ctx.instanceKey;
      if (!host || !instanceKey) {
        return null;
      }
      const wr = host.getWorkspaceRootAbsolute();
      if (!wr) {
        return null;
      }
      const cfg = stage.toolConfig;
      if (cfg.type !== 'code-runner') {
        return null;
      }
      const cwd = host.resolveCodeRunnerCwd(cfg, instanceKey);
      const relCwd = path.relative(wr, cwd) || '.';
      if (venvPythonExists(cwd)) {
        return null;
      }
      const createCfg = buildVenvCreateRunnerConfig(relCwd);
      let createRes;
      try {
        createRes = await host.runCodeRunner(createCfg, instanceKey, `${stage.id}:auto-venv-create`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return block(GATE_ID_PYTHON_VENV_BOOTSTRAP, [`自动创建 .venv 失败：${msg}`]);
      }
      if (createRes.exitCode !== 0) {
        return block(GATE_ID_PYTHON_VENV_BOOTSTRAP, [
          `自动创建 .venv 失败（exitCode=${createRes.exitCode}）`,
        ]);
      }
      const useReq = requirementsTxtOnDisk(wr, relCwd);
      const pipCfg = buildVenvPipRunnerConfig(relCwd, useReq);
      let pipRes;
      try {
        pipRes = await host.runCodeRunner(pipCfg, instanceKey, `${stage.id}:auto-venv-pip`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return block(GATE_ID_PYTHON_VENV_BOOTSTRAP, [`venv pip install 失败：${msg}`]);
      }
      if (pipRes.exitCode !== 0) {
        return block(GATE_ID_PYTHON_VENV_BOOTSTRAP, [`venv pip install 失败（exitCode=${pipRes.exitCode}）`]);
      }
      return null;
    },
  },
  {
    id: GATE_ID_TEST_RUN_DEPS_INSTALL,
    label: 'test_run 前自动 npm install',
    phase: 'pre-stage',
    priority: 25,
    when: 'before-test-run',
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      (ctx.executionHost?.readTestRunAutoNpmInstallEnabled() ?? false),
    async evaluate(ctx) {
      const host = ctx.executionHost;
      const stage = ctx.stage!;
      const instance = ctx.instance;
      const instanceKey = ctx.instanceKey;
      const stageIndex = ctx.stageIndex ?? 0;
      if (!host || !instanceKey || !instance) {
        return null;
      }
      const wr = host.getWorkspaceRootAbsolute();
      if (!wr) {
        return null;
      }
      const cfg = stage.toolConfig;
      if (cfg.type !== 'code-runner') {
        return null;
      }
      const baseCwd = host.resolveCodeRunnerCwd(cfg, instanceKey);
      const effectiveCwd = resolveTestRunEffectiveCwd({ workspaceRoot: wr, baseCwd, stage });
      if (
        !shouldAutoNpmInstallBeforeTestRun({
          stage,
          instance,
          stageIndex,
          effectiveCwd,
        })
      ) {
        return null;
      }
      const installCfg = buildAutoNpmInstallConfig(wr, effectiveCwd);
      let res;
      try {
        res = await host.runCodeRunner(installCfg, instanceKey, `${stage.id}:auto-deps`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return block(GATE_ID_TEST_RUN_DEPS_INSTALL, [
          `test_run 前自动 npm install 失败（cwd=${effectiveCwd}）：${msg}`,
        ]);
      }
      if (res.exitCode !== 0) {
        return block(GATE_ID_TEST_RUN_DEPS_INSTALL, [
          `test_run 前自动 npm install 失败（cwd=${effectiveCwd}，exitCode=${res.exitCode}）`,
        ]);
      }
      return null;
    },
  },
  {
    id: GATE_ID_TEST_RUN_PREFLIGHT,
    label: 'test_run 磁盘 preflight（M38/M39）',
    phase: 'pre-stage',
    priority: 30,
    when: 'before-test-run',
    // preflight 检测 node_modules/配置是否就绪，必须在自动 npm install 之后跑，
    // 否则会因依赖尚未安装而误报。显式声明依赖，防止重排 priority 时静默破坏顺序。
    dependsOn: [GATE_ID_TEST_RUN_DEPS_INSTALL],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      (ctx.executionHost?.readTestRunPreflightEnabled() ?? false),
    async evaluate(ctx) {
      const host = ctx.executionHost;
      const stage = ctx.stage!;
      const instanceKey = ctx.instanceKey;
      if (!host || !instanceKey) {
        return null;
      }
      const wr = host.getWorkspaceRootAbsolute();
      if (!wr) {
        return null;
      }
      const cfg = stage.toolConfig;
      if (cfg.type !== 'code-runner') {
        return null;
      }
      const cwd = host.resolveCodeRunnerCwd(cfg, instanceKey);
      const issue = await lintTestRunPreflightOnDisk({
        workspaceRoot: wr,
        cwd,
        stage,
        workflow: ctx.instance?.definition,
      });
      if (!issue) {
        return null;
      }
      return block(GATE_ID_TEST_RUN_PREFLIGHT, [issue.message], { issue });
    },
  },
  {
    id: GATE_ID_PYTHON_REQUIREMENTS_MERGE,
    label: 'test_run 前合并 decisionArtifacts.dependencies（R3b）',
    phase: 'pre-stage',
    priority: 22,
    when: 'before-test-run',
    dependsOn: [GATE_ID_TEST_RUN_PREFLIGHT],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      isSoftwareTaskType(ctx.instance?.definition.meta.taskType ?? ''),
    evaluate(ctx) {
      const host = ctx.executionHost;
      const instance = ctx.instance;
      if (!host || !instance) {
        return null;
      }
      const wr = host.getWorkspaceRootAbsolute();
      if (!wr) {
        return null;
      }
      const deps = toPipInstallableDependencies(
        collectDeclaredDependenciesFromInstance(instance.stageRuntimes, DECISION_ARTIFACTS_OUTPUT_KEY),
      );
      mergeDeclaredDependenciesIntoRequirements(wr, deps);
      pruneUndeclaredRequirements(wr, deps);
      return null;
    },
  },
  {
    id: GATE_ID_PYTHON_PIP_RESYNC,
    label: 'test_run 前 requirements 变更时 pip 重装（R3b）',
    phase: 'pre-stage',
    priority: 24,
    when: 'before-test-run',
    dependsOn: [GATE_ID_PYTHON_REQUIREMENTS_MERGE],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      isSoftwareTaskType(ctx.instance?.definition.meta.taskType ?? ''),
    async evaluate(ctx) {
      const host = ctx.executionHost;
      const instance = ctx.instance;
      const instanceKey = ctx.instanceKey;
      const stage = ctx.stage!;
      if (!host || !instance || !instanceKey) {
        return null;
      }
      const wr = host.getWorkspaceRootAbsolute();
      if (!wr) {
        return null;
      }
      const hash = requirementsContentHash(wr);
      if (!hash) {
        return null;
      }
      const meta = instance.definition.meta ?? {};
      const lastHash = typeof meta._lastRequirementsPipHash === 'string' ? meta._lastRequirementsPipHash : '';
      if (hash === lastHash) {
        return null;
      }
      const cfg = stage.toolConfig;
      if (cfg.type !== 'code-runner') {
        return null;
      }
      const cwd = host.resolveCodeRunnerCwd(cfg, instanceKey);
      const relCwd = path.relative(wr, cwd) || '.';
      if (!venvPythonExists(cwd)) {
        return null;
      }
      const useReq = requirementsTxtOnDisk(wr, relCwd);
      const pipCfg = buildVenvPipRunnerConfig(relCwd, useReq);
      const allowedDeps = toPipInstallableDependencies(
        collectDeclaredDependenciesFromInstance(instance.stageRuntimes, DECISION_ARTIFACTS_OUTPUT_KEY),
      );
      let pipRes;
      try {
        pipRes = await host.runCodeRunner(pipCfg, instanceKey, `${stage.id}:pip-resync`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return block(GATE_ID_PYTHON_PIP_RESYNC, [`requirements 变更后 pip 重装失败：${msg}`]);
      }
      if (pipRes.exitCode !== 0) {
        const { removed } = pruneUndeclaredRequirements(wr, allowedDeps);
        if (removed.length > 0) {
          try {
            pipRes = await host.runCodeRunner(pipCfg, instanceKey, `${stage.id}:pip-resync-retry`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return block(GATE_ID_PYTHON_PIP_RESYNC, [`requirements 变更后 pip 重装失败：${msg}`]);
          }
        }
      }
      if (pipRes.exitCode !== 0) {
        return block(GATE_ID_PYTHON_PIP_RESYNC, [
          `requirements 变更后 pip 重装失败（exitCode=${pipRes.exitCode}）`,
        ]);
      }
      instance.definition.meta = { ...meta, _lastRequirementsPipHash: hash };
      return null;
    },
  },
  {
    id: GATE_ID_PYTHON_DECLARED_DEPS_PRE_TEST_RUN,
    label: 'test_run 前已声明第三方依赖 hard（R3b）',
    phase: 'pre-stage',
    priority: 44,
    when: 'before-test-run',
    dependsOn: [GATE_ID_TEST_RUN_PREFLIGHT],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      isSoftwareTaskType(ctx.instance?.definition.meta.taskType ?? '') &&
      (ctx.executionHost?.readPythonPypiSymbolLintMode() ?? 'warn') === 'hard',
    evaluate(ctx) {
      const host = ctx.executionHost;
      const instance = ctx.instance;
      if (!host || !instance) {
        return null;
      }
      const wr = host.getWorkspaceRootAbsolute();
      if (!wr) {
        return null;
      }
      const pyFiles = collectWorkflowArtifacts(instance.definition).paths.filter((p) =>
        /\.py$/i.test(p),
      );
      if (pyFiles.length === 0) {
        return null;
      }
      const issues = lintDeclaredDependenciesInFiles({
        workspaceRoot: wr,
        pyFiles,
        allowedDeps: collectDeclaredDependenciesFromInstance(
          instance.stageRuntimes,
          DECISION_ARTIFACTS_OUTPUT_KEY,
        ),
        projectModuleNames: collectAllProjectModuleNamesFromInstance(
          instance.stageRuntimes,
          DECISION_ARTIFACTS_OUTPUT_KEY,
        ),
      });
      if (issues.length === 0) {
        return null;
      }
      const issue = issues[0]!;
      return block(GATE_ID_PYTHON_DECLARED_DEPS_PRE_TEST_RUN, [issue.message], { issue });
    },
  },
  {
    id: GATE_ID_SDK_PATH_CONTRACT_HARD,
    label: 'SDK/路径契约 hard 门',
    phase: 'pre-stage',
    priority: 40,
    when: 'before-test-run',
    dependsOn: [GATE_ID_TEST_RUN_PREFLIGHT],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      (ctx.executionHost?.readSdkPathContractLintMode() ?? 'off') === 'hard',
    async evaluate(ctx) {
      const host = ctx.executionHost;
      if (!host) {
        return null;
      }
      const issue = await host.runSdkPathContractHardGate();
      if (!issue) {
        return null;
      }
      return block(
        GATE_ID_SDK_PATH_CONTRACT_HARD,
        [`sdk-path-contract（M39.2 · ${issue.code}）：${issue.message}`],
        { issue },
      );
    },
  },
  {
    id: GATE_ID_PYTHON_EXPORT_CONTRACT,
    label: 'Python test/impl 导出契约（hard）',
    phase: 'pre-stage',
    priority: 45,
    when: 'before-test-run',
    dependsOn: [GATE_ID_TEST_RUN_PREFLIGHT],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      (ctx.executionHost?.readPythonExportContractLintMode() ?? 'warn') === 'hard',
    async evaluate(ctx) {
      const host = ctx.executionHost;
      if (!host) {
        return null;
      }
      const semantic = ctx.stage ? semanticNameFromTestRunStageId(ctx.stage.id) : undefined;
      const issue = await host.runPythonExportContractHardGate(semantic);
      if (!issue) {
        return null;
      }
      return block(
        GATE_ID_PYTHON_EXPORT_CONTRACT,
        [`python-export-contract（${issue.code}）：${issue.message}`],
        { issue },
      );
    },
  },
  {
    id: GATE_ID_PYTHON_PYPI_SYMBOL,
    label: 'Python 第三方 API 幻觉符号（hard）',
    phase: 'pre-stage',
    priority: 46,
    when: 'before-test-run',
    dependsOn: [GATE_ID_TEST_RUN_PREFLIGHT],
    enabled: (ctx) =>
      isTestRunStage(ctx.stage) &&
      (ctx.executionHost?.readPythonPypiSymbolLintMode() ?? 'warn') === 'hard',
    async evaluate(ctx) {
      const host = ctx.executionHost;
      if (!host) {
        return null;
      }
      const issue = await host.runPythonPypiSymbolHardGate();
      if (!issue) {
        return null;
      }
      return block(
        GATE_ID_PYTHON_PYPI_SYMBOL,
        [`python-pypi-symbol（${issue.code}）：${issue.message}`],
        { issue },
      );
    },
  },
  {
    id: GATE_ID_TEST_RUN_CONTRACT_LINT,
    label: 'test_run 前跨文件契约 lint',
    phase: 'pre-stage',
    priority: 50,
    when: 'before-test-run',
    enabled: (ctx) => isTestRunStage(ctx.stage),
    async evaluate(ctx) {
      const host = ctx.executionHost;
      if (!host) {
        return null;
      }
      const messages = await host.runWorkspaceContractLint();
      if (!messages.length) {
        return null;
      }
      const taskType = ctx.instance?.definition.meta?.taskType ?? '';
      const hardPrefixes = [
        'contract:test-inline-impl-double:',
        'contract:test-no-production-import:',
      ];
      const hardMsgs = messages.filter((m) => hardPrefixes.some((p) => m.includes(p)));
      if (isSoftwareTaskType(taskType) && hardMsgs.length > 0) {
        return block(GATE_ID_TEST_RUN_CONTRACT_LINT, messages);
      }
      return warn(GATE_ID_TEST_RUN_CONTRACT_LINT, messages);
    },
  },
  {
    id: GATE_ID_REQUIREMENTS_TXT_PREFLIGHT,
    label: 'requirements.txt PyPI 版本 preflight',
    phase: 'pre-stage',
    priority: 15,
    when: 'always',
    enabled: (ctx) => !!ctx.stage && stageInstallsRequirementsTxt(ctx.stage),
    async evaluate(ctx) {
      const host = ctx.executionHost;
      const stage = ctx.stage!;
      const instanceKey = ctx.instanceKey;
      if (!host || !instanceKey) {
        return null;
      }
      const cfg = stage.toolConfig;
      if (cfg.type !== 'code-runner') {
        return null;
      }
      const cwd = host.resolveCodeRunnerCwd(cfg, instanceKey);
      const result = preflightRequirementsTxtForPipInstall(cwd);
      if (!result.blocked) {
        return null;
      }
      return block(GATE_ID_REQUIREMENTS_TXT_PREFLIGHT, result.messages);
    },
  },
  {
    id: GATE_ID_SMOKE_DATA_BOOTSTRAP,
    label: 'smoke 前种子 config 引用的缺失 CSV fixture',
    phase: 'pre-stage',
    priority: 10,
    when: 'always',
    enabled: (ctx) => ctx.stage?.id === SMOKE_RUN_STAGE_ID,
    evaluate(ctx) {
      const wr = ctx.executionHost?.getWorkspaceRootAbsolute() ?? ctx.taskWorkspaceAbs;
      if (!wr) {
        return null;
      }
      seedSmokeCsvFixtures(wr);
      return null;
    },
  },
];
