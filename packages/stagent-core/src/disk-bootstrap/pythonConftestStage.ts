import type { Stage } from '../WorkflowDefinition';
import { STAGE_TOOL_LLM_TEXT } from '../workflow/StageToolKinds';
import { CONFTEST_TEMPLATE } from '../python-bootstrap/conftestTemplate';
import { isPythonOnlyWorkflow, planDeclaresConftest } from '../python-bootstrap/pythonStackDetect';
import type { WorkflowDefinition } from '../WorkflowDefinition';

export const STAGE_IMPL_CONFTEST_ID = 'stage_impl_conftest';

function buildConftestStage(dependsOn: string[]): Stage {
  return {
    id: STAGE_IMPL_CONFTEST_ID,
    title: 'pytest flat-layout bootstrap（conftest.py）',
    description: '写入 conftest.py，将项目根加入 sys.path，供 tests/ import 顶层模块。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig: {
      type: STAGE_TOOL_LLM_TEXT,
      systemPrompt: [
        '将以下 conftest.py 原样写入工作区根目录（writeOutputToFile=conftest.py）。',
        '不要修改内容，不要添加说明。',
        CONFTEST_TEMPLATE.trim(),
      ].join('\n'),
      writeOutputToFile: 'conftest.py',
    },
    ...(dependsOn.length ? { dependsOn } : {}),
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    meta: { executionMode: 'deterministic' },
  };
}

/** Python-only workflow：在首个 test_run 前注入 conftest 阶段（若 plan 未声明）。 */
export function injectPythonConftestStage(wf: WorkflowDefinition): WorkflowDefinition {
  if (!isPythonOnlyWorkflow(wf) || planDeclaresConftest(wf)) {
    return wf;
  }
  const stages = [...(wf.stages ?? [])];
  if (stages.some((s) => s.id === STAGE_IMPL_CONFTEST_ID)) {
    return wf;
  }
  const firstTestRunIdx = stages.findIndex((s) => s.id.startsWith('stage_test_run_'));
  if (firstTestRunIdx < 0) {
    return wf;
  }
  const anchor = stages
    .slice(0, firstTestRunIdx)
    .map((s) => s.id)
    .filter((id) => id.startsWith('stage_impl_') && !id.endsWith('_stagent_bundle_write'))
    .pop();
  const insertIdx = anchor ? stages.findIndex((s) => s.id === anchor) + 1 : firstTestRunIdx;
  stages.splice(insertIdx, 0, buildConftestStage(anchor ? [anchor] : []));
  return { ...wf, stages };
}
