import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { DependencyGraph } from '../DependencyGraphAnalyzer';
import type { ComplexityEstimate } from '../WorkflowComplexityEstimator';
import { orchestratePostParseValidation, type GenerationGateSettings } from '../WorkflowGenerationOrchestrator';

const emptyDepGraph: DependencyGraph = { nodes: new Map(), cycleDetected: false };
const smallComplexity: ComplexityEstimate = {
  estimatedImplModules: 1,
  requiresGlobalArchitectureDecision: false,
  estimatedStageCount: 3,
  exceedsHardCap: false,
  highHitlLikely: false,
};

const defaultGates: GenerationGateSettings = {
  toIssuesHorizontalLayeringFail: false,
  debugFeedbackLoopMode: 'hard',
  planCompletenessEnabled: true,
  planStructuralRepairMode: 'off',
  staticAnalysisEnabled: false,
  contractPlanPreflightV2: false,
};

const baseMeta = {
  title: 't',
  taskType: 'software',
  userInput: 'build app',
  createdAt: new Date().toISOString(),
};

function minimalSoftwareWf(): WorkflowDefinition {
  return {
    id: 'wf_min',
    version: '2.0',
    meta: baseMeta,
    stages: [
      {
        id: 'stage_decide_x',
        title: '决策',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'decide' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_x',
        title: '实现',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'impl' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'text', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_test_run_x',
        title: '测试',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm test', captureOutput: true },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'testResults', format: 'json' }],
        pauseAfter: false,
      },
    ],
  };
}

describe('WorkflowGenerationOrchestrator', () => {
  it('returns validation-errors for empty stages', async () => {
    const wf = { id: 'wf', version: '2.0', meta: baseMeta, stages: [] } as WorkflowDefinition;
    const out = await orchestratePostParseValidation({
      wf,
      effectiveType: 'software',
      uiTaskType: 'software',
      userInput: 'x',
      taskWorkspaceAbs: '/tmp/ws',
      depGraph: emptyDepGraph,
      complexity: smallComplexity,
      gates: defaultGates,
      runtimeRule20On: false,
      maxStageWarn: 45,
      normalizeWorkflow: (w) => w,
      isSuperseded: () => false,
      debugLog: () => {},
    });
    assert.equal(out.kind, 'validation-errors');
    if (out.kind === 'validation-errors') {
      assert.ok(out.errors.length > 0);
    }
  });

  it('returns success with warnings for valid minimal workflow when rule20 off', async () => {
    const out = await orchestratePostParseValidation({
      wf: minimalSoftwareWf(),
      effectiveType: 'software',
      uiTaskType: 'software',
      userInput: 'build',
      taskWorkspaceAbs: '/tmp/ws',
      depGraph: emptyDepGraph,
      complexity: smallComplexity,
      gates: { ...defaultGates, planCompletenessEnabled: false },
      runtimeRule20On: false,
      maxStageWarn: 45,
      normalizeWorkflow: (w) => w,
      isSuperseded: () => false,
      debugLog: () => {},
    });
    assert.equal(out.kind, 'success');
    if (out.kind === 'success') {
      assert.ok(Array.isArray(out.warnings));
      assert.ok(out.planSummary);
      assert.ok(out.stageSourceSummary);
    }
  });

  it('returns superseded when isSuperseded is true after validate', async () => {
    const out = await orchestratePostParseValidation({
      wf: { id: 'wf', version: '2.0', meta: baseMeta, stages: [] } as WorkflowDefinition,
      effectiveType: 'software',
      uiTaskType: 'software',
      userInput: 'x',
      taskWorkspaceAbs: '/tmp/ws',
      depGraph: emptyDepGraph,
      complexity: smallComplexity,
      gates: defaultGates,
      runtimeRule20On: false,
      maxStageWarn: 45,
      normalizeWorkflow: (w) => w,
      isSuperseded: () => true,
      debugLog: () => {},
    });
    assert.equal(out.kind, 'superseded');
  });
});
