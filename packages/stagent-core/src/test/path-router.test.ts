import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  expressTemplateStageWarnings,
  formatPathRouterBlockForPrompt,
  isExpressEligible,
  routeWorkflowTemplate,
} from '../path-router/PathRouter';
import { scanWorkspaceSignals, type WorkspaceSignals } from '../path-router/WorkspaceSignals';

function emptySignals(overrides: Partial<WorkspaceSignals> = {}): WorkspaceSignals {
  return {
    hasContextMd: false,
    hasDocsAgents: false,
    sourceFileCount: 0,
    totalLoc: 0,
    moduleCount: 0,
    topLevelFileCount: 0,
    hasSubstantialCode: false,
    ...overrides,
  };
}

test('routeWorkflowTemplate picks express for clear single-slice greenfield greet', () => {
  const userInput =
    '空目录 Python 项目。单文件 greet.py，函数 greet(name) 返回 "Hello, {name}"。单切片 TDD：test_write → impl → test_run，pytest 验收。';
  const result = routeWorkflowTemplate({
    userInput,
    signals: emptySignals(),
    uiTaskType: 'auto',
  });
  assert.equal(result.workflowTemplate, 'express');
  assert.equal(result.suggestedIsGreenfield, true);
  assert.ok(result.rationaleLines.some((l) => l.includes('express')));
});

test('routeWorkflowTemplate picks express when user explicitly asks', () => {
  const result = routeWorkflowTemplate({
    userInput: '不要多切片，走 express，修一下登录按钮文案',
    signals: emptySignals({ hasSubstantialCode: true, sourceFileCount: 5, moduleCount: 2 }),
    uiTaskType: 'auto',
  });
  assert.equal(result.workflowTemplate, 'express');
  assert.equal(result.suggestedIsGreenfield, false);
});

test('routeWorkflowTemplate picks greenfield_full for vague greenfield without express signals', () => {
  const result = routeWorkflowTemplate({
    userInput: '做一个完整的多模块电商后台，要 PRD 和垂直切片拆分，端到端交付。',
    signals: emptySignals(),
    uiTaskType: 'auto',
  });
  assert.equal(result.workflowTemplate, 'greenfield_full');
  assert.equal(result.suggestedIsGreenfield, true);
});

test('routeWorkflowTemplate picks brownfield_full for substantial multi-module repo', () => {
  const result = routeWorkflowTemplate({
    userInput: '在现有系统里新增订单导出 CSV 功能，要接 API 和权限模块。',
    signals: emptySignals({
      hasSubstantialCode: true,
      sourceFileCount: 12,
      moduleCount: 4,
      totalLoc: 800,
    }),
    uiTaskType: 'auto',
  });
  assert.equal(result.workflowTemplate, 'brownfield_full');
  assert.equal(result.suggestedIsGreenfield, false);
});

test('routeWorkflowTemplate picks debug for bug-fix intent', () => {
  const result = routeWorkflowTemplate({
    userInput: 'pytest 失败：test_login 报 401，请复现并修复回归。',
    signals: emptySignals({ hasSubstantialCode: true, sourceFileCount: 8 }),
    uiTaskType: 'auto',
  });
  assert.equal(result.workflowTemplate, 'debug');
});

test('routeWorkflowTemplate picks arch_review for architecture governance', () => {
  const result = routeWorkflowTemplate({
    userInput: '对现有 ball of mud 模块做架构治理，列出 seam 与 deletion-test 候选。',
    signals: emptySignals({ hasSubstantialCode: true, moduleCount: 6 }),
    uiTaskType: 'auto',
  });
  assert.equal(result.workflowTemplate, 'arch_review');
});

test('routeWorkflowTemplate respects ui debug task type', () => {
  const result = routeWorkflowTemplate({
    userInput: '添加新 API 端点',
    signals: emptySignals(),
    uiTaskType: 'debug',
  });
  assert.equal(result.workflowTemplate, 'debug');
});

test('isExpressEligible rejects full-project hints', () => {
  assert.equal(
    isExpressEligible('完整的多模块全栈项目，要 to-prd 和拆 issues', emptySignals()),
    false,
  );
});

test('formatPathRouterBlockForPrompt embeds template constraint', () => {
  const result = routeWorkflowTemplate({
    userInput: '单切片 TDD greet.py pytest',
    signals: emptySignals(),
    uiTaskType: 'auto',
  });
  const block = formatPathRouterBlockForPrompt(result);
  assert.ok(block.includes('workflowTemplate: express'));
  assert.ok(block.includes('workflowTemplate=express'));
});

test('expressTemplateStageWarnings fires above soft cap', () => {
  assert.deepEqual(expressTemplateStageWarnings('express', 6), []);
  assert.ok(expressTemplateStageWarnings('express', 12)[0]?.includes('express-stage-cap'));
});

test('scanWorkspaceSignals marks substantial code from file count', () => {
  const signals = scanWorkspaceSignals('/nonexistent-will-not-run', undefined);
  assert.equal(signals.hasSubstantialCode, false);
  const substantial = emptySignals({ sourceFileCount: 5, hasSubstantialCode: true });
  assert.equal(substantial.hasSubstantialCode, true);
});

test('routeWorkflowTemplate T4 multi-module software routes greenfield_full not express', () => {
  const userInput = `在南华期货场景下开发「期货自动下单」软件（Python）。
交付：config.yaml、indicators/、signals/、risk/、broker/、main.py、pytest、DELIVERY.md
多切片、完整交付。`;
  const result = routeWorkflowTemplate({
    userInput,
    signals: emptySignals(),
    uiTaskType: 'software',
  });
  assert.equal(result.workflowTemplate, 'greenfield_full');
  assert.equal(result.stackProfile, 'python');
});
