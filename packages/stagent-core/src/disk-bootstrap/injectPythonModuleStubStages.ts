import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { buildNodeExtensionScriptCommand } from '../contract-infra';
import {
  GLOBAL_CONFIG_DECIDE_STAGE_ID,
  GREENFIELD_PYTHON_SKELETON_VERSION,
} from '../plan-skeleton/constants';
import { isPythonOnlyWorkflow } from '../python-bootstrap/pythonStackDetect';
import { STAGE_TOOL_CODE_RUNNER } from '../workflow/StageToolKinds';
import {
  decideStageIdFromSemanticName,
  isDecideStageId,
  isTestWriteStageId,
  semanticNameFromTestWriteStageId,
} from '../workflow/StageIdPatterns';
import { VERIFY_OUT_OUTPUT_KEY } from '../WorkflowOutputKeys';

export function isMaterializeStubStageId(stageId: string): boolean {
  return stageId.startsWith('stage_materialize_stub_');
}

function buildMaterializeStubStage(semantic: string, decideId: string): Stage {
  return {
    id: `stage_materialize_stub_${semantic}`,
    title: `物化 stub · ${semantic}`,
    description:
      '从 decide decisionArtifacts 生成 NotImplementedError stub 模块，供 RED 链 verify_imports --strict。',
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig: {
      type: 'code-runner',
      command: buildNodeExtensionScriptCommand('materialize-python-module-stub.mjs', [semantic]),
      captureOutput: true,
      pathBase: 'workspace',
      workingDir: '.',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: VERIFY_OUT_OUTPUT_KEY, format: 'text' }],
    pauseAfter: false,
    dependsOn: [decideId],
    meta: { executionMode: 'deterministic' },
  };
}

function shouldInjectPythonModuleStubs(wf: WorkflowDefinition): boolean {
  if (!isPythonOnlyWorkflow(wf)) {
    return false;
  }
  const stages = wf.stages ?? [];
  const hasSlicePipeline =
    stages.some((s) => isDecideStageId(s.id)) && stages.some((s) => isTestWriteStageId(s.id));
  if (!hasSlicePipeline) {
    return false;
  }
  if (wf.meta?.skeletonVersion === GREENFIELD_PYTHON_SKELETON_VERSION) {
    return true;
  }
  if (wf.meta?.workflowTemplate === 'greenfield_full') {
    return true;
  }
  // finalize 可能剥离 skeletonVersion / workflowTemplate；以全局架构 decide 标记兜底
  if (wf.meta?.engineAutoInsertedGlobalArchitectureStageId === GLOBAL_CONFIG_DECIDE_STAGE_ID) {
    return true;
  }
  return stages.some((s) => s.id === GLOBAL_CONFIG_DECIDE_STAGE_ID);
}

/**
 * 在每个切片 decide 与 test_write 之间插入 stage_materialize_stub_*（R4）。
 */
export function injectPythonModuleStubStages(wf: WorkflowDefinition): WorkflowDefinition {
  if (!shouldInjectPythonModuleStubs(wf)) {
    return wf;
  }
  let stages = [...(wf.stages ?? [])];
  const insertions: Array<{ afterId: string; stage: Stage; testWriteId: string }> = [];

  for (const stage of stages) {
    if (!isTestWriteStageId(stage.id)) {
      continue;
    }
    const semantic = semanticNameFromTestWriteStageId(stage.id);
    if (!semantic) {
      continue;
    }
    const decideId = decideStageIdFromSemanticName(semantic);
    const stubId = `stage_materialize_stub_${semantic}`;
    if (!decideId || stages.some((s) => s.id === stubId)) {
      continue;
    }
    const decideIdx = stages.findIndex((s) => s.id === decideId);
    const twIdx = stages.findIndex((s) => s.id === stage.id);
    if (decideIdx >= 0 && twIdx === decideIdx + 1) {
      insertions.push({
        afterId: decideId,
        stage: buildMaterializeStubStage(semantic, decideId),
        testWriteId: stage.id,
      });
    }
  }

  for (const ins of [...insertions].reverse()) {
    const idx = stages.findIndex((s) => s.id === ins.afterId);
    if (idx >= 0) {
      stages.splice(idx + 1, 0, ins.stage);
    }
  }

  const stubIds = new Set(insertions.map((i) => i.stage.id));
  stages = stages.map((s) => {
    if (!isTestWriteStageId(s.id)) {
      return s;
    }
    const semantic = semanticNameFromTestWriteStageId(s.id);
    const stubId = semantic ? `stage_materialize_stub_${semantic}` : '';
    if (stubId && stubIds.has(stubId)) {
      return { ...s, dependsOn: [stubId] };
    }
    return s;
  });

  return { ...wf, stages };
}
