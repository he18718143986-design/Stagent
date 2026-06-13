import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { collectWorkflowArtifacts, relativePathToPythonTopModule } from '../WorkflowArtifactRegistry';
import type { WorkflowDefinition } from '../WorkflowDefinition';

test('relativePathToPythonTopModule extracts top-level module', () => {
  assert.equal(relativePathToPythonTopModule('reader.py'), 'reader');
  assert.equal(relativePathToPythonTopModule('pkg/mod.py'), 'mod');
  assert.equal(relativePathToPythonTopModule('indicators/__init__.py'), 'indicators');
  assert.equal(relativePathToPythonTopModule('src/indicators/__init__.py'), 'indicators');
  assert.equal(relativePathToPythonTopModule('config.yaml'), undefined);
});

test('collectWorkflowArtifacts gathers writeOutputToFile and file-write paths', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_art',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl_prototype_config',
        title: 'config',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'config.yaml',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'fileContent', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_prototype_reader',
        title: 'reader',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'reader.py',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'fileContent', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const reg = collectWorkflowArtifacts(wf);
  assert.equal(reg.pathSet.has('config.yaml'), true);
  assert.equal(reg.pathSet.has('reader.py'), true);
  assert.equal(reg.moduleSet.has('reader'), true);
  assert.equal(reg.moduleSet.has('config'), false);
});

test('collectWorkflowArtifacts registers package __init__.py as top-level module', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_pkg',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_impl_indicators',
        title: 'indicators',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'indicators/__init__.py',
          writePathBase: 'workspace',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'fileContent', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const reg = collectWorkflowArtifacts(wf);
  assert.equal(reg.pathSet.has('indicators/__init__.py'), true);
  assert.equal(reg.moduleSet.has('indicators'), true);
  assert.equal(reg.moduleSet.has('__init__'), false);
});
