import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { applySemanticFillToSkeleton } from '../plan-skeleton/applySemanticFillToSkeleton';
import { expandGreenfieldPythonSkeleton } from '../plan-skeleton/expandGreenfieldPythonSkeleton';
import { fillSkeletonStagePrompts } from '../plan-skeleton/fillSkeletonStagePrompts';
import { SKELETON_PROMPT_PLACEHOLDER_PREFIX } from '../plan-skeleton/constants';
import { T4_REQUIREMENT_SNIPPET } from './fixtures/t4RequirementSnippet';

test('fillSkeletonStagePrompts applies mock LLM JSON to skeleton stages', async () => {
  const { workflow, modules } = expandGreenfieldPythonSkeleton({
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    modules: ['signals', 'risk', 'broker', 'main'],
  });
  const filledPrompt = '为 signals 模块编写 pytest RED 测试，仅 import 契约 exports。';
  const host = {
    postGenerationProgress: () => {},
    invokeLlmRaw: async () =>
      JSON.stringify({
        stagePrompts: {
          stage_test_write_signals: filledPrompt,
        },
        globalModules: [{ name: 'signals', exports: ['compute'] }],
      }),
    warn: () => {},
  };
  const fill = await fillSkeletonStagePrompts(host as never, {} as never, {
    userInput: T4_REQUIREMENT_SNIPPET,
    modules,
    stages: workflow.stages ?? [],
  });
  assert.ok(fill);
  const applied = applySemanticFillToSkeleton(workflow, fill!.stagePrompts);
  const tw = applied.stages.find((s) => s.id === 'stage_test_write_signals');
  assert.ok(tw?.toolConfig.type === 'llm-text');
  if (tw?.toolConfig.type === 'llm-text') {
    assert.equal(tw.toolConfig.systemPrompt, filledPrompt);
    assert.equal(tw.toolConfig.systemPrompt?.includes(SKELETON_PROMPT_PLACEHOLDER_PREFIX), false);
  }
});

test('fillSkeletonStagePrompts returns null after parse retries exhausted', async () => {
  const { workflow, modules } = expandGreenfieldPythonSkeleton({
    userInput: 'x',
    taskType: 'software',
    modules: ['signals', 'risk', 'broker', 'main'],
  });
  let warned = false;
  const host = {
    postGenerationProgress: () => {},
    invokeLlmRaw: async () => 'not json',
    warn: () => {
      warned = true;
    },
  };
  const fill = await fillSkeletonStagePrompts(host as never, {} as never, {
    userInput: 'x',
    modules,
    stages: workflow.stages ?? [],
  });
  assert.equal(fill, null);
  assert.equal(warned, true);
});
