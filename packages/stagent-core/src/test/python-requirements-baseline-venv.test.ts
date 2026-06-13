import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { expandGreenfieldPythonSkeleton } from '../plan-skeleton/expandGreenfieldPythonSkeleton';
import { injectPythonModuleStubStages } from '../disk-bootstrap/injectPythonModuleStubStages';
import { injectSelfHealStages } from '../workflow-self-heal/injectSelfHealStages';
import { T4_REQUIREMENT_SNIPPET } from './fixtures/t4RequirementSnippet';

test('injectSelfHealStages inserts ensure baseline before venv pip for skeleton python', () => {
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    modules: ['signals', 'risk', 'broker', 'main'],
  });
  const withStubs = injectPythonModuleStubStages(workflow);
  const { workflow: healed } = injectSelfHealStages(withStubs);
  const ids = healed.stages.map((s) => s.id);
  const ensureIdx = ids.indexOf('stage_ensure_requirements_baseline');
  const pipIdx = ids.indexOf('stage_venv_pip_install');
  assert.ok(ensureIdx >= 0, 'missing stage_ensure_requirements_baseline');
  assert.ok(pipIdx > ensureIdx, 'pip must follow ensure baseline');
  const pip = healed.stages[pipIdx];
  assert.ok(pip?.toolConfig.type === 'code-runner');
  if (pip?.toolConfig.type === 'code-runner') {
    assert.match(pip.toolConfig.command, /pip install -r requirements\.txt/);
  }
  const importCheck = healed.stages.find((s) => s.id === 'stage_venv_import_check');
  assert.match(
    importCheck?.toolConfig.type === 'code-runner' ? importCheck.toolConfig.command : '',
    /import numpy, pandas/,
  );
});
