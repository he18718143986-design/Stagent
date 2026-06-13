import type { WorkflowDefinition } from '../WorkflowDefinition';
import { injectSelfHealStages } from '../workflow-self-heal/injectSelfHealStages';
import { injectFileWriteAfterImplStages } from './injectedStages';
import { injectInitNpmWorkspaceStage, stripNodeJsBootstrapStages } from './initNpmStages';
import { isPythonOnlyWorkflow } from '../python-bootstrap/pythonStackDetect';
import { injectPythonConftestStage } from './pythonConftestStage';
import { augmentTestRunToWorkspaceRoot } from './testRunAugment';
import { injectDeliveryWrapupStage } from './deliveryWrapupStage';
import { injectPythonModuleStubStages } from './injectPythonModuleStubStages';
import { injectSmokeStage } from './smokeStage';
import { injectDemoStages } from './demoStage';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { readDemoDeliveryEnabled } from '../settings/readers/exec';

export function applySoftwareDiskPipeline(wf: WorkflowDefinition): WorkflowDefinition {
  const stages = Array.isArray(wf.stages) ? [...wf.stages] : [];
  const pyOnly = isPythonOnlyWorkflow({ ...wf, stages });
  const nextStages = pyOnly
    ? stripNodeJsBootstrapStages(stages)
    : injectInitNpmWorkspaceStage(stages);
  const withBundles = injectFileWriteAfterImplStages(nextStages);
  const withConftest = injectPythonConftestStage({ ...wf, stages: withBundles });
  const withStubs = injectPythonModuleStubStages(withConftest);
  const { workflow: withSelfHeal } = injectSelfHealStages(withStubs);
  augmentTestRunToWorkspaceRoot(withSelfHeal.stages);
  // 交付收口：末尾追加 DELIVERY.md 验收阶段（在全部实现/测试之后）。
  const withDelivery = injectDeliveryWrapupStage(withSelfHeal.stages);
  // B-Q1 有界 smoke：在交付收口前「真启动一次」（可推导启动命令时）。
  const withSmoke = injectSmokeStage(withDelivery);
  const demoEnabled = readDemoDeliveryEnabled(getStagentConfiguration());
  const withDemo = injectDemoStages(withSmoke, { enabled: demoEnabled });
  return { ...wf, stages: withDemo };
}
