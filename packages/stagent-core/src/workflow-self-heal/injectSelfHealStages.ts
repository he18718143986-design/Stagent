import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import {
  isDecideStageId,
  isImplStageId,
  isTestRunStageId,
  isTestWriteStageId,
  semanticNameFromTestRunStageId,
} from '../workflow/StageIdPatterns';
import { findLastImplStageIndex } from '../TddSliceScope';
import { isPythonOnlyWorkflow } from '../python-bootstrap/pythonStackDetect';
import {
  firstPythonInfraAnchorIndex,
  lastRequirementsTxtWriterStageId,
  planDeclaresRequirementsTxt,
  pythonVenvChainComplete,
  pythonVenvChainStatusBefore,
  detectSelfHealInfraGaps,
  PYTHON_REQUIREMENTS_BASELINE_STAGE_ID,
  resolveVenvImportCheckCommand,
  resolveVenvPipInstallCommand,
  usesRequirementsTxtForVenvPip,
} from '../contract-infra';
import { isMaterializeStubStageId } from '../disk-bootstrap/injectPythonModuleStubStages';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { readPythonVerifyImportsStrict } from '../settings/readers/exec';
import {
  buildEnsureRequirementsBaselineStage,
  buildFixIfFailedStage,
  buildNpmInstallServerStage,
  buildPythonFixIfFailedStage,
  buildServerAppEntryStage,
  buildVerifyImportsStage,
  buildVerifyPythonImportsStage,
  buildVerifyServerTscStage,
  buildVenvCreateStage,
  buildVenvImportCheckStage,
  buildVenvPipInstallStage,
  resolvePythonImplFileForFix,
  resolvePythonTestFileForVerify,
  resolveServerTestFileForVerify,
  isBundleWriteStageId,
  isSelfHealStageId,
} from './SelfHealStageFactory';

export interface SelfHealInjectionResult {
  workflow: WorkflowDefinition;
  insertedStageIds: string[];
  movedStageIds: string[];
  violations: string[];
}

function stageIndex(stages: Stage[], id: string): number {
  return stages.findIndex((s) => s.id === id);
}

function hasStage(stages: Stage[], id: string): boolean {
  return stages.some((s) => s.id === id);
}

function lastImplBefore(stages: Stage[], beforeIdx: number): number {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const s = stages[i]!;
    if (isImplStageId(s.id) && !isBundleWriteStageId(s.id) && !isSelfHealStageId(s.id)) {
      return i;
    }
    if (isDecideStageId(s.id)) {
      break;
    }
  }
  return -1;
}

function isServerSliceTestRun(testRunId: string): boolean {
  const semantic = semanticNameFromTestRunStageId(testRunId) ?? '';
  return (
    semantic.includes('integration') ||
    semantic.includes('chat_integration') ||
    semantic.includes('voice')
  );
}

function matchingTestWriteId(testRunId: string): string | undefined {
  const runSemantic = semanticNameFromTestRunStageId(testRunId);
  if (!runSemantic) {
    return undefined;
  }
  return `stage_test_write_${runSemantic}`;
}

function insertAfter(stages: Stage[], afterId: string, toInsert: Stage[]): Stage[] {
  const idx = stageIndex(stages, afterId);
  if (idx < 0) {
    return [...stages, ...toInsert];
  }
  const next = [...stages];
  next.splice(idx + 1, 0, ...toInsert);
  return next;
}

function moveStageAfter(stages: Stage[], stageId: string, afterId: string): { stages: Stage[]; moved: boolean } {
  const from = stageIndex(stages, stageId);
  const after = stageIndex(stages, afterId);
  if (from < 0 || after < 0 || from === after + 1) {
    return { stages, moved: false };
  }
  const next = [...stages];
  const [item] = next.splice(from, 1);
  const adjustedAfter = from < after ? after - 1 : after;
  next.splice(adjustedAfter + 1, 0, item!);
  return { stages: next, moved: true };
}

function resolveVenvChainAnchor(stages: Stage[], beforeTestRunIdx: number): string | undefined {
  const prior = stages.slice(0, beforeTestRunIdx);
  const pipOrInit = prior
    .map((s) => s.id)
    .filter((id) => /stage_venv_pip_install|stage_venv_init/.test(id))
    .pop();
  if (pipOrInit) {
    return pipOrInit;
  }
  const create = prior
    .map((s) => s.id)
    .filter((id) => /stage_venv_create/.test(id))
    .pop();
  if (create) {
    return create;
  }
  const lastImpl = prior
    .map((s) => s.id)
    .filter((id) => isImplStageId(id) && !isBundleWriteStageId(id) && !isSelfHealStageId(id))
    .pop();
  if (lastImpl) {
    return lastImpl;
  }
  return prior[prior.length - 1]?.id;
}

const VENV_CHAIN_STAGE_IDS = [
  'stage_venv_create',
  PYTHON_REQUIREMENTS_BASELINE_STAGE_ID,
  'stage_venv_pip_install',
  'stage_venv_import_check',
] as const;

function hasStageInList(stages: readonly Stage[], id: string): boolean {
  return stages.some((s) => s.id === id);
}

function patchVenvChainDependsOn(stages: Stage[], afterStageId: string): Stage[] {
  const bundleId = `${afterStageId}_stagent_bundle_write`;
  const createDepends = hasStageInList(stages, bundleId) ? [bundleId] : [afterStageId];
  const hasEnsure = hasStageInList(stages, PYTHON_REQUIREMENTS_BASELINE_STAGE_ID);
  return stages.map((s) => {
    if (s.id === 'stage_venv_create') {
      return { ...s, dependsOn: createDepends };
    }
    if (s.id === PYTHON_REQUIREMENTS_BASELINE_STAGE_ID) {
      return { ...s, dependsOn: ['stage_venv_create'] };
    }
    if (s.id === 'stage_venv_pip_install') {
      return {
        ...s,
        dependsOn: [hasEnsure ? PYTHON_REQUIREMENTS_BASELINE_STAGE_ID : 'stage_venv_create'],
      };
    }
    if (s.id === 'stage_venv_import_check') {
      return { ...s, dependsOn: ['stage_venv_pip_install'] };
    }
    return s;
  });
}

function patchVenvPipAndImportCommands(stages: Stage[]): Stage[] {
  if (!usesRequirementsTxtForVenvPip(stages)) {
    return stages;
  }
  const pipCmd = resolveVenvPipInstallCommand(stages);
  const importCmd = resolveVenvImportCheckCommand(stages);
  return stages.map((s) => {
    if (s.id === 'stage_venv_pip_install' && s.toolConfig.type === 'code-runner') {
      return { ...s, toolConfig: { ...s.toolConfig, command: pipCmd } };
    }
    if (s.id === 'stage_venv_import_check' && s.toolConfig.type === 'code-runner') {
      return { ...s, toolConfig: { ...s.toolConfig, command: importCmd } };
    }
    return s;
  });
}

/** Python venv pip 前插入 requirements 基线种子（pytest / numpy / pandas）。 */
export function ensureRequirementsBaselineBeforePip(
  stages: Stage[],
): { stages: Stage[]; insertedStageIds: string[]; violations: string[] } {
  const insertedStageIds: string[] = [];
  const violations: string[] = [];
  const pipIdx = stages.findIndex((s) => s.id === 'stage_venv_pip_install');
  if (pipIdx < 0) {
    return { stages, insertedStageIds, violations };
  }
  let next = [...stages];
  if (!hasStage(next, PYTHON_REQUIREMENTS_BASELINE_STAGE_ID)) {
    const createIdx = next.findIndex((s) => s.id === 'stage_venv_create');
    const insertAfterId =
      createIdx >= 0 ? 'stage_venv_create' : next[pipIdx - 1]?.id ?? next[0]?.id;
    if (insertAfterId) {
      next = insertAfter(next, insertAfterId, [
        buildEnsureRequirementsBaselineStage([insertAfterId]),
      ]);
      insertedStageIds.push(PYTHON_REQUIREMENTS_BASELINE_STAGE_ID);
      violations.push('已插入 stage_ensure_requirements_baseline（pytest / numpy / pandas）');
    }
  }
  next = patchVenvPipAndImportCommands(next);
  const hasEnsure = hasStage(next, PYTHON_REQUIREMENTS_BASELINE_STAGE_ID);
  if (hasEnsure) {
    next = next.map((s) => {
      if (s.id === PYTHON_REQUIREMENTS_BASELINE_STAGE_ID) {
        return { ...s, dependsOn: ['stage_venv_create'] };
      }
      if (s.id === 'stage_venv_pip_install') {
        return { ...s, dependsOn: [PYTHON_REQUIREMENTS_BASELINE_STAGE_ID] };
      }
      return s;
    });
  }
  return { stages: next, insertedStageIds, violations };
}

/**
 * E9：requirements.txt 由后续 impl 落盘时，将 venv 链移到该阶段之后（仍在 test_run 前）。
 */
export function reorderVenvChainAfterRequirementsWriter(
  stages: Stage[],
  beforeTestRunIdx: number,
): { stages: Stage[]; moved: boolean; violations: string[] } {
  if (!planDeclaresRequirementsTxt(stages)) {
    return { stages, moved: false, violations: [] };
  }
  const reqWriterId = lastRequirementsTxtWriterStageId(stages, beforeTestRunIdx);
  if (!reqWriterId) {
    return { stages, moved: false, violations: [] };
  }
  const reqWriterIdx = stageIndex(stages, reqWriterId);
  const venvStages = stages.filter((s) => VENV_CHAIN_STAGE_IDS.includes(s.id as (typeof VENV_CHAIN_STAGE_IDS)[number]));
  if (venvStages.length === 0) {
    return { stages, moved: false, violations: [] };
  }
  const firstVenvIdx = stages.findIndex((s) =>
    VENV_CHAIN_STAGE_IDS.includes(s.id as (typeof VENV_CHAIN_STAGE_IDS)[number]),
  );
  if (firstVenvIdx < 0 || firstVenvIdx > reqWriterIdx) {
    return { stages, moved: false, violations: [] };
  }
  const withoutVenv = stages.filter(
    (s) => !VENV_CHAIN_STAGE_IDS.includes(s.id as (typeof VENV_CHAIN_STAGE_IDS)[number]),
  );
  const insertAt = stageIndex(withoutVenv, reqWriterId);
  if (insertAt < 0) {
    return { stages, moved: false, violations: [] };
  }
  const next = [...withoutVenv];
  next.splice(insertAt + 1, 0, ...venvStages);
  return {
    stages: patchVenvChainDependsOn(next, reqWriterId),
    moved: true,
    violations: [`venv 链已移至 ${reqWriterId}（requirements.txt 落盘）之后`],
  };
}

/** 在首个 pytest test_run 前补齐 venv 三段链（create → pip → import_check）。 */
export function injectPythonVenvChainBeforeTestRun(
  stages: Stage[],
  beforeTestRunIdx: number,
): { stages: Stage[]; insertedStageIds: string[]; violations: string[] } {
  const insertedStageIds: string[] = [];
  const violations: string[] = [];
  let next = [...stages];
  const status = pythonVenvChainStatusBefore(next, beforeTestRunIdx);
  if (pythonVenvChainComplete(status)) {
    return { stages: next, insertedStageIds, violations };
  }

  let anchor = resolveVenvChainAnchor(next, beforeTestRunIdx);
  if (!anchor) {
    return { stages: next, insertedStageIds, violations };
  }

  if (!status.create && !status.merged && !hasStage(next, 'stage_venv_create')) {
    next = insertAfter(next, anchor, [buildVenvCreateStage([anchor])]);
    insertedStageIds.push('stage_venv_create');
    violations.push('首个 test_run 前缺少 stage_venv_create，已自动插入');
    anchor = 'stage_venv_create';
  }

  const afterCreate = pythonVenvChainStatusBefore(next, beforeTestRunIdx);
  if (!afterCreate.pip && !afterCreate.merged && !hasStage(next, 'stage_venv_pip_install')) {
    let pipDepends = hasStage(next, 'stage_venv_create') ? ['stage_venv_create'] : [anchor];
    if (!planDeclaresRequirementsTxt(next) && !hasStage(next, PYTHON_REQUIREMENTS_BASELINE_STAGE_ID)) {
      next = insertAfter(next, pipDepends[0]!, [
        buildEnsureRequirementsBaselineStage(pipDepends),
      ]);
      insertedStageIds.push(PYTHON_REQUIREMENTS_BASELINE_STAGE_ID);
      violations.push('已插入 stage_ensure_requirements_baseline（pytest / numpy / pandas）');
      pipDepends = [PYTHON_REQUIREMENTS_BASELINE_STAGE_ID];
    }
    const pipCmd = resolveVenvPipInstallCommand(next);
    next = insertAfter(next, pipDepends[0]!, [buildVenvPipInstallStage(pipDepends, pipCmd)]);
    insertedStageIds.push('stage_venv_pip_install');
    violations.push(
      usesRequirementsTxtForVenvPip(next)
        ? '已插入 stage_venv_pip_install（requirements.txt）'
        : '已插入 stage_venv_pip_install（pytest）',
    );
    anchor = 'stage_venv_pip_install';
  }

  const afterPip = pythonVenvChainStatusBefore(next, beforeTestRunIdx);
  if (!afterPip.importCheck && !hasStage(next, 'stage_venv_import_check')) {
    const importDepends = hasStage(next, 'stage_venv_pip_install')
      ? ['stage_venv_pip_install']
      : hasStage(next, 'stage_venv_create')
        ? ['stage_venv_create']
        : [anchor];
    next = insertAfter(next, importDepends[0]!, [
      buildVenvImportCheckStage(importDepends, resolveVenvImportCheckCommand(next)),
    ]);
    insertedStageIds.push('stage_venv_import_check');
    violations.push('已插入 stage_venv_import_check');
  }

  return { stages: next, insertedStageIds, violations };
}

function planUsesPythonVerifyImportsStrict(stages: Stage[]): boolean {
  if (!readPythonVerifyImportsStrict(getStagentConfiguration())) {
    return false;
  }
  return stages.some((s) => isMaterializeStubStageId(s.id));
}

/**
 * 为工作流注入自修复阶段：verify_tsc / verify_imports / fix_if_failed / npm_install，
 * 并纠正 test_write 排在 impl 之前的违规顺序。
 */
export function injectSelfHealStages(workflow: WorkflowDefinition): SelfHealInjectionResult {
  let stages = [...(workflow.stages ?? [])];
  const insertedStageIds: string[] = [];
  const movedStageIds: string[] = [];
  const violations: string[] = [];
  const pyOnly = isPythonOnlyWorkflow(workflow);

  const firstTestRunIdx = stages.findIndex((s) => isTestRunStageId(s.id));
  if (
    firstTestRunIdx >= 0 &&
    !pyOnly &&
    !hasStage(stages, 'stage_npm_install_server')
  ) {
    const anchor =
      stages
        .slice(0, firstTestRunIdx)
        .map((s) => s.id)
        .filter((id) => isImplStageId(id) && !isBundleWriteStageId(id))
        .pop() ?? stages[firstTestRunIdx - 1]?.id;
    if (anchor) {
      stages = insertAfter(stages, anchor, [buildNpmInstallServerStage([anchor])]);
      insertedStageIds.push('stage_npm_install_server');
    }
  }

  const pyInfraAnchor = firstPythonInfraAnchorIndex(workflow);
  if (pyOnly && pyInfraAnchor >= 0) {
    const chain = injectPythonVenvChainBeforeTestRun(stages, pyInfraAnchor);
    stages = chain.stages;
    insertedStageIds.push(...chain.insertedStageIds);
    violations.push(...chain.violations);
    const reordered = reorderVenvChainAfterRequirementsWriter(stages, pyInfraAnchor);
    if (reordered.moved) {
      stages = reordered.stages;
      movedStageIds.push(...VENV_CHAIN_STAGE_IDS.filter((id) => hasStage(stages, id)));
      violations.push(...reordered.violations);
    }
    const baseline = ensureRequirementsBaselineBeforePip(stages);
    stages = baseline.stages;
    insertedStageIds.push(...baseline.insertedStageIds);
    violations.push(...baseline.violations);
  }

  if (!pyOnly && !hasStage(stages, 'stage_impl_server_app')) {
    const entryBundle = 'stage_impl_server_entry_stagent_bundle_write';
    if (hasStage(stages, entryBundle)) {
      stages = insertAfter(stages, entryBundle, [buildServerAppEntryStage([entryBundle])]);
      insertedStageIds.push('stage_impl_server_app');
    }
  }

  if (!pyOnly && !hasStage(stages, 'stage_verify_server_bootstrap_tsc')) {
    const anchor = hasStage(stages, 'stage_impl_server_app')
      ? 'stage_impl_server_app'
      : 'stage_impl_server_entry_stagent_bundle_write';
    if (hasStage(stages, anchor)) {
      stages = insertAfter(stages, anchor, [
        buildVerifyServerTscStage({
          id: 'stage_verify_server_bootstrap_tsc',
          title: '验证服务端可编译（bootstrap）',
          dependsOn: [anchor],
        }),
      ]);
      insertedStageIds.push('stage_verify_server_bootstrap_tsc');
    }
  }

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!;
    if (!isTestRunStageId(stage.id)) {
      continue;
    }

    const testRunId = stage.id;
    const testWriteId = matchingTestWriteId(testRunId);
    const writeIdx = testWriteId ? stageIndex(stages, testWriteId) : -1;
    const runIdx = stageIndex(stages, testRunId);

    if (writeIdx >= 0 && writeIdx > runIdx) {
      violations.push(`${testWriteId} 排在 ${testRunId} 之后`);
    }

    if (writeIdx >= 0 && testWriteId) {
      const lastImplIdx = findLastImplStageIndex(stages, runIdx);
      if (lastImplIdx >= 0 && writeIdx < lastImplIdx) {
        const anchorImpl = stages[lastImplIdx]!;
        const redFirstTdd = (anchorImpl.dependsOn ?? []).includes(testWriteId);
        if (!redFirstTdd) {
          const bundleId = `${anchorImpl.id}_stagent_bundle_write`;
          const moveAfterId = hasStage(stages, bundleId) ? bundleId : anchorImpl.id;
          const moved = moveStageAfter(stages, testWriteId, moveAfterId);
          if (moved.moved) {
            stages = moved.stages;
            movedStageIds.push(testWriteId);
            violations.push(`${testWriteId} 原在 impl 之前，已移至 ${moveAfterId} 之后`);
          }
        }
      }
    }

    const semantic = semanticNameFromTestRunStageId(testRunId) ?? 'slice';
    const verifyTscId = `stage_verify_${semantic}_tsc`;
    const verifyImportsId = `stage_verify_imports_${semantic}`;
    const fixId = `stage_fix_if_failed_${semantic}`;

    if (!pyOnly && isServerSliceTestRun(testRunId) && !hasStage(stages, verifyTscId)) {
      const writeId = testWriteId && hasStage(stages, testWriteId) ? testWriteId : undefined;
      const anchor = writeId ?? (lastImplBefore(stages, runIdx) >= 0 ? stages[lastImplBefore(stages, runIdx)]!.id : undefined);
      if (anchor) {
        stages = insertAfter(stages, anchor, [
          buildVerifyServerTscStage({
            id: verifyTscId,
            title: `验证可编译（${semantic}）`,
            dependsOn: [anchor],
          }),
        ]);
        insertedStageIds.push(verifyTscId);
      }
    }

    const refreshedWriteIdx = testWriteId ? stageIndex(stages, testWriteId) : -1;
    const refreshedRunIdx = stageIndex(stages, testRunId);
    if (refreshedWriteIdx >= 0 && refreshedRunIdx >= 0) {
      const between = stages.slice(refreshedWriteIdx + 1, refreshedRunIdx);
      const hasVerifyBetween = between.some((s) => s.id.startsWith('stage_verify_imports_'));
      if (!hasVerifyBetween && !hasStage(stages, verifyImportsId)) {
        const testFile = pyOnly
          ? resolvePythonTestFileForVerify(testRunId, stages)
          : resolveServerTestFileForVerify(testRunId, stages);
        if (testFile) {
          const verifyStage = pyOnly
            ? buildVerifyPythonImportsStage({
                id: verifyImportsId,
                title: `验证 Python 测试 import（${semantic}）`,
                testFiles: [testFile],
                dependsOn: [testWriteId!],
                strict: planUsesPythonVerifyImportsStrict(stages),
              })
            : buildVerifyImportsStage({
                id: verifyImportsId,
                title: `验证测试 import 路径（${semantic}）`,
                testFiles: [testFile],
                dependsOn: [testWriteId!],
              });
          stages = insertAfter(stages, testWriteId!, [verifyStage]);
          insertedStageIds.push(verifyImportsId);
          violations.push(`${testRunId} 前缺少 verify_imports，已插入 ${verifyImportsId}`);
        }
      } else if (refreshedRunIdx === refreshedWriteIdx + 1) {
        violations.push(`禁止模式：${testRunId} 紧跟 ${testWriteId}，无 verify_imports`);
      }
    }

    if (!hasStage(stages, fixId)) {
      const fixSkipIf = {
        type: 'exitCodeZero' as const,
        stageId: testRunId,
        outputKey: CODE_RUNNER_EXIT_OUTPUT_KEY,
      };
      if (pyOnly) {
        const pyTarget = resolvePythonImplFileForFix(testRunId, stages) ?? `${semantic}.py`;
        stages = insertAfter(stages, testRunId, [
          {
            ...buildPythonFixIfFailedStage({
              id: fixId,
              title: `修复失败测试（${semantic}）`,
              testRunStageId: testRunId,
              dependsOn: [testRunId],
              writeTargets: [pyTarget, 'requirements.txt'],
            }),
            skipIf: fixSkipIf,
          },
        ]);
      } else {
        const tscForFix = hasStage(stages, verifyTscId)
          ? verifyTscId
          : hasStage(stages, 'stage_verify_server_bootstrap_tsc')
            ? 'stage_verify_server_bootstrap_tsc'
            : verifyTscId;
        stages = insertAfter(stages, testRunId, [
          {
            ...buildFixIfFailedStage({
              id: fixId,
              title: `修复失败测试（${semantic}）`,
              testRunStageId: testRunId,
              verifyTscStageId: tscForFix,
              dependsOn: [testRunId],
              writeTargets: ['server/src/app.ts', 'server/src/index.ts'],
            }),
            skipIf: fixSkipIf,
          },
        ]);
      }
      insertedStageIds.push(fixId);
    }
  }

  return {
    workflow: { ...workflow, stages },
    insertedStageIds,
    movedStageIds,
    violations,
  };
}

/** 列出仍缺少自修复链路的 test_run 阶段（注入后审计）。 */
export function auditSelfHealGaps(workflow: WorkflowDefinition): string[] {
  return detectSelfHealInfraGaps(workflow);
}
