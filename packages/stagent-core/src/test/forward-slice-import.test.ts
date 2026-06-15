import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildForwardSliceImportFixHints,
  buildForwardSliceImportPreventionSuffix,
  collectWorkflowSliceOrder,
  laterSlicesInWorkflow,
  lintForwardSliceImportsInImpl,
} from '../python-contract/ForwardSliceImportLint';
import type { WorkflowDefinition } from '../WorkflowDefinition';

const SLICE_ORDER = ['indicators', 'signals', 'risk', 'broker', 'main'];

function makeWf(): WorkflowDefinition {
  return {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
    stages: SLICE_ORDER.map((s) => ({
      id: `stage_decide_${s}`,
      title: s,
      tool: 'llm-text' as const,
      toolConfig: { type: 'llm-text' as const, systemPrompt: 'decide' },
      input: { sources: [], mergeStrategy: 'concat' as const },
      outputs: [{ key: 'decisionRecord', format: 'markdown' as const }],
      pauseAfter: true,
      isDecisionStage: true,
    })),
  };
}

test('collectWorkflowSliceOrder preserves decide order', () => {
  assert.deepEqual(collectWorkflowSliceOrder(makeWf()), SLICE_ORDER);
});

test('laterSlicesInWorkflow returns broker/main after risk', () => {
  assert.deepEqual(laterSlicesInWorkflow('risk', SLICE_ORDER), ['broker', 'main']);
});

test('lintForwardSliceImportsInImpl flags risk importing broker before broker exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-slice-'));
  fs.mkdirSync(path.join(dir, 'risk'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'risk/__init__.py'),
    'from broker import SimBroker\n\ndef check_stop_loss():\n    return SimBroker.get_settlement_price("x")\n',
  );
  const issue = lintForwardSliceImportsInImpl({
    workspaceRoot: dir,
    implRelPath: 'risk/__init__.py',
    currentSemantic: 'risk',
    sliceOrder: SLICE_ORDER,
  });
  assert.ok(issue);
  assert.equal(issue.code, 'python-forward-slice-import');
  assert.match(issue.message, /broker/);
});

test('lintForwardSliceImportsInImpl passes when broker package exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-slice-'));
  fs.mkdirSync(path.join(dir, 'risk'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'broker'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'broker/__init__.py'), 'class SimBroker: pass\n');
  fs.writeFileSync(path.join(dir, 'risk/__init__.py'), 'from broker import SimBroker\n');
  assert.equal(
    lintForwardSliceImportsInImpl({
      workspaceRoot: dir,
      implRelPath: 'risk/__init__.py',
      currentSemantic: 'risk',
      sliceOrder: SLICE_ORDER,
    }),
    null,
  );
});

test('buildForwardSliceImportPreventionSuffix lists later slices + rule', () => {
  const suffix = buildForwardSliceImportPreventionSuffix({
    currentSemantic: 'risk',
    sliceOrder: SLICE_ORDER,
  });
  assert.ok(suffix);
  assert.match(suffix, /broker/);
  assert.match(suffix, /main/);
  assert.match(suffix, /lazy|可注入/);
});

test('buildForwardSliceImportPreventionSuffix returns null for last slice', () => {
  assert.equal(
    buildForwardSliceImportPreventionSuffix({ currentSemantic: 'main', sliceOrder: SLICE_ORDER }),
    null,
  );
});

test('buildForwardSliceImportFixHints for Run #53 risk/broker pattern', () => {
  const diagnostic =
    'ModuleNotFoundError: No module named \'broker\'\nrisk/__init__.py:1: in <module>\n    from broker import SimBroker';
  const hints = buildForwardSliceImportFixHints({
    diagnostic,
    currentSemantic: 'risk',
    sliceOrder: SLICE_ORDER,
  });
  assert.ok(hints.length >= 2);
  assert.match(hints.join('\n'), /lazy|可注入/);
});
