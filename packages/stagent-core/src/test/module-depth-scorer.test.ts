import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  analyzePythonModuleDepth,
  classifyDepthRatio,
  formatModuleDepthWarning,
  moduleDepthPenalty,
  scoreModuleDepth,
} from '../ModuleDepthScorer';

test('classifyDepthRatio：阈值分类', () => {
  assert.equal(classifyDepthRatio(12), 'deep');
  assert.equal(classifyDepthRatio(6), 'moderate');
  assert.equal(classifyDepthRatio(2), 'shallow');
});

test('scoreModuleDepth：深模块高分', () => {
  const r = scoreModuleDepth({ publicSymbolCount: 1, implementationLines: 60 });
  assert.equal(r.classification, 'deep');
  assert.equal(r.score, 1);
});

test('scoreModuleDepth：浅模块（接口面≈实现）低分', () => {
  const r = scoreModuleDepth({ publicSymbolCount: 8, implementationLines: 16 });
  assert.equal(r.classification, 'shallow');
  assert.equal(r.score, 0.3);
});

test('scoreModuleDepth：体量过小给中性分（不误判浅）', () => {
  const r = scoreModuleDepth({ publicSymbolCount: 3, implementationLines: 5 });
  assert.equal(r.classification, 'moderate');
});

test('moduleDepthPenalty：仅浅模块惩罚', () => {
  assert.equal(moduleDepthPenalty({ ratio: 2, classification: 'shallow', score: 0.3 }), 0.3);
  assert.equal(moduleDepthPenalty({ ratio: 12, classification: 'deep', score: 1 }), 0);
});

test('analyzePythonModuleDepth：薄包装识别为浅', () => {
  const content = `import os

def a(x):
    return _impl(x)

def b(x):
    return _impl(x)

def c(x):
    return _impl(x)

def d(x):
    return _impl(x)

def e(x):
    return _impl(x)

def f(x):
    return _impl(x)

def g(x):
    return _impl(x)
`;
  const r = analyzePythonModuleDepth(content);
  assert.equal(r.classification, 'shallow');
  assert.ok(formatModuleDepthWarning('wrap.py', r)?.startsWith('architecture:shallow-module'));
});

test('analyzePythonModuleDepth：单一接口大实现识别为深', () => {
  const body = Array.from({ length: 40 }, (_, i) => `    step_${i} = compute(${i})`).join('\n');
  const content = `def process(data):\n${body}\n    return aggregate(data)\n`;
  const r = analyzePythonModuleDepth(content);
  assert.equal(r.classification, 'deep');
  assert.equal(formatModuleDepthWarning('deep.py', r), undefined);
});
