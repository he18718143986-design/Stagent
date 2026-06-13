import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countPathLikeTokens,
  detectMultiModuleLayout,
} from '../path-router/multiModuleLayoutDetect';
import { lintMultiModuleSliceCoverage } from '../plan-completeness/multiModuleLayoutChecks';

const T4_SNIPPET = `
交付：config.yaml、indicators/、signals/、risk/、broker/（SimBroker）、main.py、pytest
`;

test('T4-style requirement hits multiModuleLayout for software', () => {
  assert.ok(
    detectMultiModuleLayout({ taskType: 'software', userInput: T4_SNIPPET }),
  );
  assert.ok(countPathLikeTokens(T4_SNIPPET) >= 4);
});

test('T3 calculator does not hit multiModuleLayout', () => {
  assert.equal(
    detectMultiModuleLayout({
      taskType: 'software',
      userInput: '实现 calculator 模块 add/sub，test_calculator.py pytest',
    }),
    false,
  );
});

test('prototype taskType never hits multiModuleLayout', () => {
  assert.equal(
    detectMultiModuleLayout({ taskType: 'prototype', userInput: T4_SNIPPET }),
    false,
  );
});

test('lintMultiModuleSliceCoverage requires 4 impl stages', () => {
  const issue = lintMultiModuleSliceCoverage({
    id: 'wf',
    version: '2.0',
    meta: {
      title: 't',
      taskType: 'software',
      userInput: T4_SNIPPET,
      createdAt: '',
    },
    stages: [
      {
        id: 'stage_impl_a',
        title: 'a',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [],
        pauseAfter: false,
      },
    ],
    globalConfig: {},
  });
  assert.ok(issue);
  assert.equal(issue.type, 'multi-module-insufficient-slices');
});
