import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { expandGreenfieldPythonSkeleton } from '../plan-skeleton';
import { applyRule20StructuralNormalizations } from '../rule20-normalize';
import {
  lintImplWiredToModuleDecide,
  lintSliceDecideDeclaresDecisionArtifacts,
  lintTestWriteWiredToModuleDecide,
} from '../plan-completeness/moduleContractChecks';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { T4_REQUIREMENT_SNIPPET } from './fixtures/t4RequirementSnippet';

test('skeleton slice decide stages declare decisionArtifacts output', () => {
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
  });
  const issues = lintSliceDecideDeclaresDecisionArtifacts(workflow);
  assert.equal(issues.length, 0);
  for (const semantic of ['indicators', 'signals', 'main']) {
    const stage = workflow.stages.find((s) => s.id === `stage_decide_${semantic}`);
    assert.ok(stage?.outputs?.some((o) => o.key === DECISION_ARTIFACTS_OUTPUT_KEY));
  }
});

test('normalize wires test_write and impl to module contract sources', () => {
  const { workflow } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
  });
  applyRule20StructuralNormalizations(workflow);
  assert.equal(lintTestWriteWiredToModuleDecide(workflow).length, 0);
  assert.equal(lintImplWiredToModuleDecide(workflow).length, 0);
  const tw = workflow.stages.find((s) => s.id === 'stage_test_write_signals')!;
  assert.ok(
    tw.input.sources.some(
      (s) => s.type === 'stage-output' && s.stageId === 'stage_decide_signals' && s.outputKey === 'decisionArtifacts',
    ),
  );
});
