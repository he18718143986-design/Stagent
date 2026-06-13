import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildDependencyGraph,
  dependencyGraphToWarningLines,
  formatDependencyGraphForPrompt,
} from '../DependencyGraphAnalyzer';

test('buildDependencyGraph detects relative imports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-dep-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), "import { b } from './b';\nexport const a = b;\n");
  fs.writeFileSync(path.join(dir, 'src', 'b.ts'), "import { a } from './a';\nexport const b = 1;\n");
  fs.writeFileSync(path.join(dir, 'src', 'hub.ts'), "import { a } from './a';\nimport { b } from './b';\nexport const h = a + b;\n");
  const graph = buildDependencyGraph(path.join(dir, 'src'));
  assert.ok(graph.nodes.size >= 2);
  assert.ok(graph.cycleDetected);
  const warnings = dependencyGraphToWarningLines(graph);
  assert.ok(warnings.some((w) => w.startsWith('dependency-graph:')));
});

test('empty src dir yields empty graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-dep-empty-'));
  const graph = buildDependencyGraph(dir);
  assert.equal(graph.nodes.size, 0);
  assert.equal(formatDependencyGraphForPrompt(graph), '');
});

test('formatDependencyGraphForPrompt summarizes nodes for generator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-dep-fmt-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main.ts'), "import { util } from './util';\nexport const m = util;\n");
  fs.writeFileSync(path.join(dir, 'src', 'util.ts'), 'export const util = 1;\n');
  const graph = buildDependencyGraph(path.join(dir, 'src'));
  const block = formatDependencyGraphForPrompt(graph);
  assert.ok(block.includes('import 依赖图摘要'));
  assert.ok(block.includes('main.ts'));
});
