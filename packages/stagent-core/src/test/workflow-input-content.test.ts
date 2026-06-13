import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  estimateTokens,
  primaryOutputKey,
  stageOutputToText,
  toReferenceText,
  truncateStageOutputForInput,
} from '../WorkflowInputContent';
import type { InputSource, Stage } from '../WorkflowDefinition';

test('primaryOutputKey returns first output key or text fallback', () => {
  assert.equal(primaryOutputKey({ outputs: [{ key: 'sourceCode' }] } as Stage), 'sourceCode');
  assert.equal(primaryOutputKey({ outputs: [] } as unknown as Stage), 'text');
});

test('stageOutputToText passes strings through and JSON-stringifies others', () => {
  assert.equal(stageOutputToText('hello'), 'hello');
  assert.equal(stageOutputToText(42), '42');
  assert.equal(stageOutputToText(null), '""');
  assert.equal(stageOutputToText(undefined), '""');
  assert.equal(stageOutputToText({ a: 1 }), '{"a":1}');
});

test('estimateTokens approximates 4 chars per token', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(40)), 10);
});

test('truncateStageOutputForInput truncates beyond token limit', () => {
  const short = 'x'.repeat(8);
  assert.equal(truncateStageOutputForInput(short, 100), short);
  const long = 'y'.repeat(4000);
  const out = truncateStageOutputForInput(long, 10);
  assert.ok(out.startsWith('y'.repeat(40)));
  assert.ok(out.includes('内容已截断'));
});

test('toReferenceText builds collapsed preview block', () => {
  const source = { type: 'stage-output', stageId: 's1', outputKey: 'k1' } as InputSource;
  const ref = toReferenceText(source, '  multi\n  line\t content  ');
  assert.ok(ref.startsWith('[reference]'));
  assert.ok(ref.includes('stageId=s1'));
  assert.ok(ref.includes('outputKey=k1'));
  assert.ok(ref.includes('preview=multi line content'));
});
