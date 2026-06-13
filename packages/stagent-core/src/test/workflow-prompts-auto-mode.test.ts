import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorkflowGeneratorPrompt } from '../WorkflowPrompts';
import { AUTO_TASK_TYPE } from '../TaskTypeResolution';

test('auto mode prompt includes taskType classification and all type constraint blocks', () => {
  const prompt = buildWorkflowGeneratorPrompt(AUTO_TASK_TYPE, {
    userInput: 'Python 脚本读 Excel 输出 CSV',
  });
  assert.ok(prompt.includes('meta.taskType 分类'));
  assert.ok(prompt.includes('software | refactor | debug | prototype | document | other'));
  assert.ok(prompt.includes('Python/Shell/数据分析脚本'));
  assert.ok(prompt.includes("taskType='refactor'"));
  assert.ok(prompt.includes("taskType='debug'"));
  assert.ok(prompt.includes("taskType='prototype'"));
  assert.ok(prompt.includes('Rule 20: Decision Stage Insertion'));
  assert.ok(prompt.includes('document / other'));
});

test('explicit software mode still uses software-only prompt without classification block', () => {
  const prompt = buildWorkflowGeneratorPrompt('software');
  assert.ok(prompt.includes('Rule 20: Decision Stage Insertion'));
  assert.equal(prompt.includes('meta.taskType 分类'), false);
});

test('auto mode includes web template hint when userInput hints web stack', () => {
  const prompt = buildWorkflowGeneratorPrompt('auto', {
    userInput: '做一个 React + Vite 网页端后台',
  });
  assert.ok(prompt.includes('Web Minimal Complete Project Template'));
});

test('auto and prototype prompts require python venv + python3 -m pip for Python code-runner', () => {
  const autoPrompt = buildWorkflowGeneratorPrompt(AUTO_TASK_TYPE, {
    userInput: 'Python 脚本读 Excel 输出 CSV',
  });
  for (const prompt of [
    autoPrompt,
    buildWorkflowGeneratorPrompt('prototype', { userInput: 'Python mock pipeline' }),
    buildWorkflowGeneratorPrompt('other', { userInput: 'pytest 脚本' }),
  ]) {
    assert.ok(prompt.includes('python3 -m venv .venv'), prompt.slice(0, 80));
    assert.ok(prompt.includes('.venv/bin/python -m pip install'), prompt);
    assert.ok(prompt.includes('FORBIDDEN: `pip install -r requirements.txt && python script.py`'), prompt);
  }
});

test('prototype prompt forbids mega setup_project and requires per-file writeOutputToFile', () => {
  const prompt = buildWorkflowGeneratorPrompt('prototype', {
    userInput: 'Python 供货核对：config.yaml main.py reader.py Excel input',
  });
  assert.ok(prompt.includes('MULTI-FILE prototype disk layout'));
  assert.ok(prompt.includes('FORBIDDEN'));
  assert.ok(prompt.includes('setup_project.py'));
  assert.ok(prompt.includes('stage_impl_prototype_main'));
  assert.ok(prompt.includes('writeOutputToFile'));
});

test('prototype prompt requires Excel fixture path and column alignment across create_sample and test_run', () => {
  const prompt = buildWorkflowGeneratorPrompt('prototype', {
    userInput: 'Python 读 Excel 对比价格，create_sample 生成样本',
  });
  assert.ok(prompt.includes('EXCEL / sample-data alignment'));
  assert.ok(prompt.includes('input.xlsx'));
  assert.ok(prompt.includes('create_sample.py'));
  assert.ok(prompt.includes('stage_test_run_*'));
  assert.ok(prompt.includes('TargetPrice'));
  assert.ok(prompt.includes('FORBIDDEN: create_sample with Chinese headers'));
});

test('prototype prompt includes artifact input alignment for test_run imports', () => {
  const prompt = buildWorkflowGeneratorPrompt('prototype', {
    userInput: 'Python multi-file with fetcher and config.yaml',
  });
  assert.ok(prompt.includes('ARTIFACT / input alignment'));
  assert.ok(prompt.includes('ARTIFACT_REGISTRY'));
  assert.ok(prompt.includes('from config import'));
});
