import type { Stage, WorkflowDefinition } from './WorkflowDefinition';
import { isDataPipelineCoreStage } from './HITLContractNodePolicy';

/**
 * M21.2：原型工作流「数据契约」生成期结构 lint（warning-only，不阻断生成）。
 *
 * 弥补三类此前只在 prompt 软约束、未被机器校验的薄弱环：
 * 1) create_sample 与 mock_data 各自瞎编 ASIN，未共享同一份样例源 → sample-mock-source-unshared
 * 2) 数据管道核心 impl（reader/fetcher/analyzer/writer/main）未引用 decisionRecord → impl-missing-decision-source
 * 3) 集成 test_run 仅断言行数、不校验内容正确性（≥1 条 query_status=success + 有效告警/正常）→ weak-integration-assertion
 *
 * token 形如 `contract:<type>:<stageId>`，与 Rule20WarningDisplay 解析一致。
 */

export type PrototypeContractWarningType =
  | 'sample-mock-source-unshared'
  | 'impl-missing-decision-source'
  | 'weak-integration-assertion';

function getWriteFile(stage: Stage): string {
  const tc = stage.toolConfig as { writeOutputToFile?: string; command?: string };
  return (tc?.writeOutputToFile ?? '').trim();
}

function getCommand(stage: Stage): string {
  const tc = stage.toolConfig as { command?: string };
  return (tc?.command ?? '').trim();
}

export function isPrototypeWorkflow(wf: WorkflowDefinition): boolean {
  if (wf.meta?.taskType === 'prototype') {
    return true;
  }
  return (wf.stages ?? []).some((s) => /_prototype_/.test(s.id));
}

function findDecisionStageIds(wf: WorkflowDefinition): string[] {
  return (wf.stages ?? [])
    .filter(
      (s) =>
        s.isDecisionStage === true &&
        (s.outputs ?? []).some((o) => o.key === 'decisionRecord'),
    )
    .map((s) => s.id);
}

function referencesStageOutput(stage: Stage, targetStageId: string): boolean {
  return (stage.input?.sources ?? []).some(
    (s) => s.type === 'stage-output' && s.stageId === targetStageId,
  );
}

function isCreateSampleStage(stage: Stage): boolean {
  return /create_sample/.test(stage.id) || /create_sample\.py$/i.test(getWriteFile(stage));
}

function isMockDataStage(stage: Stage): boolean {
  return /mock_?data/.test(stage.id) || /mock_?data.*\.json$/i.test(getWriteFile(stage));
}

/** 集成阶段：跑 main / pipeline / monitor 入口脚本的 stage_test_run_*（code-runner） */
function isIntegrationTestRunStage(stage: Stage): boolean {
  if (!/^stage_test_run_/.test(stage.id) || stage.tool !== 'code-runner') {
    return false;
  }
  const cmd = getCommand(stage);
  return /\b(main|monitor|pipeline)\.py\b/i.test(cmd) || /_main\b|_mock_pipeline\b|_pipeline\b/i.test(stage.id);
}

const COUNT_ASSERT_HINT = /len\(\s*rows?\s*\)|len\(\s*files?\s*\)|>=\s*\d|>\s*\d|==\s*\d/;
const CONTENT_ASSERT_HINT =
  /query_status|success|in_stock|stock_status|availabilit|alert|告警|正常|deviation|price|not_found|延迟|delivery|status\s*==|!=/i;

/** 集成命令是否只数行数、不校验内容（弱断言） */
export function isWeakIntegrationAssertion(command: string): boolean {
  if (!command.trim()) {
    return false;
  }
  if (!/\bassert\b/.test(command)) {
    // 跑了 main 却完全没有任何断言 → 视为弱
    return true;
  }
  const hasCount = COUNT_ASSERT_HINT.test(command);
  const hasContent = CONTENT_ASSERT_HINT.test(command);
  return hasCount && !hasContent;
}

/** stage 直接依赖的上游 stageId 集（input.sources stage-output ∪ dependsOn）。 */
function directDependencyIds(stage: Stage): string[] {
  const ids: string[] = [];
  for (const s of stage.input?.sources ?? []) {
    if (s.type === 'stage-output' && s.stageId) {
      ids.push(s.stageId);
    }
  }
  for (const d of stage.dependsOn ?? []) {
    if (d) {
      ids.push(d);
    }
  }
  return ids;
}

/** from 是否能沿依赖边（input.sources/dependsOn）传递到达 to（任一方向调用以覆盖双向）。 */
function dependencyPathExists(stages: Stage[], fromId: string, toId: string): boolean {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toId) {
      return true;
    }
    if (seen.has(cur)) {
      continue;
    }
    seen.add(cur);
    const st = byId.get(cur);
    if (st) {
      queue.push(...directDependencyIds(st));
    }
  }
  return false;
}

/**
 * 文件中介：create_sample 与 mock_data 之间存在「桥接」code-runner —— 运行 create_sample 产物
 * 或显式提取 ASIN 列表（读取生成的样例再喂给 mock）。这是比直接 stage-output 边更真实的共享方式。
 */
function hasAsinBridgeBetween(stages: Stage[], createSample: Stage, mockData: Stage): boolean {
  const ci = stages.indexOf(createSample);
  const mi = stages.indexOf(mockData);
  if (ci < 0 || mi < 0) {
    return false;
  }
  const lo = Math.min(ci, mi);
  const hi = Math.max(ci, mi);
  const sampleFile = getWriteFile(createSample); // e.g. create_sample.py
  const sampleBase = sampleFile.replace(/\.[^.]+$/, '').split(/[/\\]/).pop() ?? '';
  for (let i = lo + 1; i < hi; i += 1) {
    const s = stages[i];
    if (s.tool !== 'code-runner') {
      continue;
    }
    const cmd = getCommand(s);
    const referencesSample =
      (!!sampleFile && cmd.includes(sampleFile)) || (!!sampleBase && new RegExp(`\\b${sampleBase}\\b`).test(cmd));
    const extractsAsin = /asin/i.test(cmd) || /asin/i.test(s.id) || /asin|样本|样例/i.test(s.title ?? '');
    if (referencesSample || extractsAsin) {
      return true;
    }
  }
  return false;
}

/**
 * M27.2：把 `sample-mock-source-unshared` 升为强约束。返回**确实未共享**时的 mockData stageId（供生成期硬门阻断），
 * 已共享 / 不适用时返回 undefined。
 *
 * 「共享」的判定（满足任一即视为已共享，避免误拦合法计划）：
 * 1) 直接 stage-output 引用边（mock_data ↔ create_sample 任一方向）；
 * 2) 传递依赖可达（input.sources/dependsOn 链，覆盖经中间阶段的间接引用）；
 * 3) 文件中介：两者之间存在「运行 create_sample / 提取 ASIN 列表」的桥接 code-runner（先生成样例再据其 ASIN 造 mock）。
 *
 * 仅当三者皆不满足（create_sample 与 mock_data 之间毫无关联、各自瞎编 ASIN）才阻断。
 */
export function detectUnsharedSampleMockSource(wf: WorkflowDefinition): string | undefined {
  if (!isPrototypeWorkflow(wf)) {
    return undefined;
  }
  const stages = wf.stages ?? [];
  const createSample = stages.find(isCreateSampleStage);
  const mockData = stages.find(isMockDataStage);
  if (!createSample || !mockData) {
    return undefined;
  }
  if (referencesStageOutput(mockData, createSample.id) || referencesStageOutput(createSample, mockData.id)) {
    return undefined;
  }
  if (
    dependencyPathExists(stages, mockData.id, createSample.id) ||
    dependencyPathExists(stages, createSample.id, mockData.id)
  ) {
    return undefined;
  }
  if (hasAsinBridgeBetween(stages, createSample, mockData)) {
    return undefined;
  }
  return mockData.id;
}

export function lintPrototypeDataContract(wf: WorkflowDefinition): string[] {
  const warnings: string[] = [];
  if (!isPrototypeWorkflow(wf)) {
    return warnings;
  }
  const stages = wf.stages ?? [];

  // 1) 样例 / mock 数据是否共享同一份 ASIN 源
  const createSample = stages.find(isCreateSampleStage);
  const mockData = stages.find(isMockDataStage);
  if (createSample && mockData) {
    const shared =
      referencesStageOutput(mockData, createSample.id) ||
      referencesStageOutput(createSample, mockData.id);
    if (!shared) {
      warnings.push(`contract:sample-mock-source-unshared:${mockData.id}`);
    }
  }

  // 2) 数据管道核心 impl 是否引用 decisionRecord
  const decisionStageIds = findDecisionStageIds(wf);
  if (decisionStageIds.length > 0) {
    for (const stage of stages) {
      if (!isDataPipelineCoreStage(stage)) {
        continue;
      }
      const refsDecision = (stage.input?.sources ?? []).some(
        (s) =>
          s.type === 'stage-output' &&
          s.outputKey === 'decisionRecord' &&
          (s.stageId === undefined || decisionStageIds.includes(s.stageId)),
      );
      if (!refsDecision) {
        warnings.push(`contract:impl-missing-decision-source:${stage.id}`);
      }
    }
  }

  // 3) 集成 test_run 断言是否仅数行数
  const integrationStages = stages.filter(isIntegrationTestRunStage);
  for (const stage of integrationStages) {
    if (isWeakIntegrationAssertion(getCommand(stage))) {
      warnings.push(`contract:weak-integration-assertion:${stage.id}`);
    }
  }

  return warnings;
}
