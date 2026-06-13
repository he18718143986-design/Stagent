import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildWorkflowGeneratorPrompt,
  multiModuleUserIntentHint,
  uniappUserIntentHint,
  webUserIntentHint,
} from '../WorkflowPrompts';

test('buildWorkflowGeneratorPrompt includes layered engineering borrowing for software', () => {
  const prompt = buildWorkflowGeneratorPrompt('software');
  assert.equal(prompt.includes('Layered engineering & test strategy'), true);
  assert.equal(prompt.includes('esModuleInterop'), true);
  assert.equal(prompt.includes('CodeRunnerCommandLint'), true);
  assert.equal(prompt.includes('analyze:failures'), true);
  assert.equal(prompt.includes('binary allowlist'), true);
});

test('buildWorkflowGeneratorPrompt adds infra hints to refactor debug prototype', () => {
  // refactor 文案为「工程与测试（分层借鉴，与 software 同源）」，在「借鉴」后是逗号而非「）」，故用共同前缀断言。
  const prefix = '工程与测试（分层借鉴';
  assert.equal(buildWorkflowGeneratorPrompt('refactor').includes(prefix), true);
  assert.equal(buildWorkflowGeneratorPrompt('debug').includes(prefix), true);
  assert.equal(buildWorkflowGeneratorPrompt('prototype').includes(prefix), true);
});

test('buildWorkflowGeneratorPrompt includes refactor constraints', () => {
  const prompt = buildWorkflowGeneratorPrompt('refactor');
  assert.equal(prompt.includes("taskType='refactor'"), true);
  assert.equal(prompt.includes('stage_decide_refactor_<X>'), true);
  assert.equal(prompt.includes('stage_test_write_<X>'), true);
  assert.equal(prompt.includes('stage_test_run_<X>'), true);
  assert.equal(prompt.includes('严格按照已确认的决策清单实现'), true);
});

test('buildWorkflowGeneratorPrompt keeps software-only rule20 branch', () => {
  const prompt = buildWorkflowGeneratorPrompt('software');
  assert.equal(prompt.includes('Rule 20: Decision Stage Insertion for Software Workflows'), true);
  assert.equal(prompt.includes('SPEC §7.8 Multi-Module'), true);
  assert.equal(prompt.includes('dependsOn'), true);
});

test('buildWorkflowGeneratorPrompt emphasizes §7.8 when userInput hints multi-module', () => {
  assert.equal(multiModuleUserIntentHint('构建多模块订单中心'), true);
  const prompt = buildWorkflowGeneratorPrompt('software', { userInput: '构建多模块订单中心' });
  assert.equal(prompt.includes('§7.8 多模块'), true);
  assert.equal(prompt.includes('stage_decide_architecture_overview'), true);
});

test('buildWorkflowGeneratorPrompt includes web minimal project template when userInput hints web', () => {
  assert.equal(webUserIntentHint('做一个 React + Vite 网页端后台'), true);
  const prompt = buildWorkflowGeneratorPrompt('software', { userInput: '做一个 React + Vite 网页端后台' });
  assert.equal(prompt.includes('Web Minimal Complete Project Template'), true);
  assert.equal(prompt.includes('stage_impl_web_package_json'), true);
  assert.equal(prompt.includes('npm run build'), true);
  assert.equal(prompt.includes('"writeOutputToFile"?: string'), true);
  assert.equal(prompt.includes('你只负责生成'), true);
  assert.equal(prompt.includes('"packageJson"'), true);
  assert.equal(prompt.includes('禁止 decisionRecord'), true);
  assert.equal(prompt.includes('HARD GATE'), true);
  assert.equal(prompt.includes('esModuleInterop'), true);
});

test('buildWorkflowGeneratorPrompt includes uni-app minimal template when userInput hints uni-app', () => {
  assert.equal(uniappUserIntentHint('使用 uni-app 做微信小程序'), true);
  const prompt = buildWorkflowGeneratorPrompt('software', { userInput: '使用 uni-app 做微信小程序' });
  assert.equal(prompt.includes('Uni-app Minimal Complete Project Template'), true);
  assert.equal(prompt.includes('stage_impl_uniapp_package_json'), true);
  assert.equal(prompt.includes('build:mp-weixin'), true);
  assert.equal(prompt.includes('npm install'), true);
  assert.equal(prompt.includes('"packageJson"'), true);
  assert.equal(prompt.includes('禁止 decisionRecord'), true);
  assert.equal(prompt.includes('HARD GATE'), true);
  assert.equal(prompt.includes('Web Minimal Complete Project Template'), false);
  assert.equal(prompt.includes('^4.0.0'), true);
  assert.equal(prompt.includes('ETARGET'), true);
});

test('buildWorkflowGeneratorPrompt includes debug constraints', () => {
  const prompt = buildWorkflowGeneratorPrompt('debug');
  assert.equal(prompt.includes("taskType='debug'"), true);
  assert.equal(prompt.includes('stage_reproduce_debug_case'), true);
  assert.equal(prompt.includes('stage_hypothesis_debug_root_cause'), true);
  assert.equal(prompt.includes('stage_impl_debug_fix'), true);
  assert.equal(prompt.includes('stage_test_run_debug_regression'), true);
});

test('buildWorkflowGeneratorPrompt includes prototype constraints', () => {
  const prompt = buildWorkflowGeneratorPrompt('prototype');
  assert.equal(prompt.includes("taskType='prototype'"), true);
  assert.equal(prompt.includes('stage_decide_prototype_hypothesis'), true);
  assert.equal(prompt.includes('MULTI-FILE prototype disk layout'), true);
  assert.equal(prompt.includes('stage_impl_prototype_main'), true);
  assert.equal(prompt.includes('stage_test_run_prototype_experiment'), true);
  assert.equal(prompt.includes('setup_project.py'), true);
});
