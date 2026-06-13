import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintDeclaredDependenciesInFiles } from '../python-contract/PythonDeclaredDependenciesLint';

test('lintDeclaredDependenciesInFiles blocks undeclared talib', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-deps-'));
  const rel = 'indicators.py';
  fs.writeFileSync(path.join(dir, rel), 'import talib\n\ndef compute_ma():\n    return talib.MA()\n');
  const issues = lintDeclaredDependenciesInFiles({
    workspaceRoot: dir,
    pyFiles: [rel],
    allowedDeps: ['pytest', 'numpy', 'pandas'],
    projectModuleNames: ['indicators'],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.code, 'python-undeclared-dependency');
  assert.equal(issues[0]!.package, 'talib');
});

test('lintDeclaredDependenciesInFiles allows declared numpy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-deps-'));
  const rel = 'signals.py';
  fs.writeFileSync(path.join(dir, rel), 'import numpy as np\n');
  const issues = lintDeclaredDependenciesInFiles({
    workspaceRoot: dir,
    pyFiles: [rel],
    allowedDeps: ['pytest', 'numpy', 'pandas'],
    projectModuleNames: ['signals'],
  });
  assert.equal(issues.length, 0);
});
