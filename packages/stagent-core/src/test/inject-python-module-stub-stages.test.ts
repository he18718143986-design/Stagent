import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { injectPythonModuleStubStages } from '../disk-bootstrap/injectPythonModuleStubStages';
import { bindStagentConfigPort } from '../settings/bindStagentConfig';
import { expandGreenfieldPythonSkeleton } from '../plan-skeleton/expandGreenfieldPythonSkeleton';
import { injectSelfHealStages } from '../workflow-self-heal/injectSelfHealStages';
import { T4_REQUIREMENT_SNIPPET } from './fixtures/t4RequirementSnippet';

test('injectPythonModuleStubStages inserts decide → materialize_stub → test_write', () => {
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    modules: ['signals', 'risk', 'broker', 'main'],
  });
  const withStubs = injectPythonModuleStubStages(workflow);
  const ids = withStubs.stages.map((s) => s.id);
  const sigIdx = ids.indexOf('stage_decide_signals');
  assert.ok(sigIdx >= 0);
  assert.equal(ids[sigIdx + 1], 'stage_materialize_stub_signals');
  assert.equal(ids[sigIdx + 2], 'stage_test_write_signals');
  const tw = withStubs.stages.find((s) => s.id === 'stage_test_write_signals');
  assert.deepEqual(tw?.dependsOn, ['stage_materialize_stub_signals']);
});

test('injectPythonModuleStubStages works when finalize stripped skeleton meta', () => {
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    modules: ['signals', 'risk', 'broker', 'main'],
  });
  const stripped = {
    ...workflow,
    meta: {
      ...workflow.meta,
      skeletonVersion: undefined,
      workflowTemplate: undefined,
      engineAutoInsertedGlobalArchitectureStageId: 'stage_decide_architecture_overview',
    },
  };
  const withStubs = injectPythonModuleStubStages(stripped);
  assert.ok(withStubs.stages.some((s) => s.id === 'stage_materialize_stub_signals'));
});

test('self-heal verify_imports follows materialize_stub with strict flag in command', () => {
  bindStagentConfigPort({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === 'python.verifyImportsStrict') return true as T;
      return defaultValue;
    },
  });
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    modules: ['signals', 'risk', 'broker', 'main'],
  });
  const withStubs = injectPythonModuleStubStages(workflow);
  const { workflow: healed } = injectSelfHealStages(withStubs);
  const verify = healed.stages.find((s) => s.id === 'stage_verify_imports_signals');
  assert.ok(verify);
  const cmd =
    verify?.toolConfig.type === 'code-runner' ? String(verify.toolConfig.command) : '';
  assert.match(cmd, /--strict/);
  const stubIdx = healed.stages.findIndex((s) => s.id === 'stage_materialize_stub_signals');
  const verifyIdx = healed.stages.findIndex((s) => s.id === 'stage_verify_imports_signals');
  const implIdx = healed.stages.findIndex((s) => s.id === 'stage_impl_signals');
  assert.ok(stubIdx >= 0 && verifyIdx > stubIdx && implIdx > verifyIdx);
});
