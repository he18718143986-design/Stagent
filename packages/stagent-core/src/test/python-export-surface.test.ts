import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintImplExportsAgainstModuleContract } from '../python-contract/ModuleContractLint';
import { extractExportedSymbols, lintPythonExportContractFromPaths } from '../python-contract/PythonExportContractLint';

const MACD_WITH_NESTED_EMA = `import pandas as pd

def compute_ma(df: pd.DataFrame) -> pd.DataFrame:
    return df

def compute_macd(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    def ema(series, span):
        return series.ewm(span=span, adjust=False).mean()
    result['macd'] = ema(result['close'], 14)
    return result
`;

test('extractExportedSymbols ignores nested def/class (module-top only)', () => {
  const exported = extractExportedSymbols(MACD_WITH_NESTED_EMA);
  assert.equal(exported.has('ema'), false);
  assert.equal(exported.has('compute_ma'), true);
  assert.equal(exported.has('compute_macd'), true);
});

test('extractExportedSymbols still counts module-level extra def', () => {
  const exported = extractExportedSymbols(`${MACD_WITH_NESTED_EMA}\ndef rogue_helper():\n    pass\n`);
  assert.equal(exported.has('rogue_helper'), true);
});

test('lintImplExportsAgainstModuleContract allows nested helper (T4 ema case)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-surface-'));
  const implPath = 'indicators/__init__.py';
  fs.mkdirSync(path.join(dir, 'indicators'), { recursive: true });
  fs.writeFileSync(path.join(dir, implPath), MACD_WITH_NESTED_EMA);
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'indicators', exports: ['compute_ma', 'compute_macd'] }],
  };
  const issue = lintImplExportsAgainstModuleContract({
    workspaceRoot: dir,
    implRelPath: implPath,
    semantic: 'indicators',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.equal(issue, null);
});

test('lintImplExportsAgainstModuleContract blocks true module-level extra export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-surface-'));
  const implPath = 'indicators.py';
  fs.writeFileSync(
    path.join(dir, implPath),
    'def compute_ma():\n    return 1\n\ndef rogue_helper():\n    return 2\n',
  );
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'indicators', exports: ['compute_ma'] }],
  };
  const issue = lintImplExportsAgainstModuleContract({
    workspaceRoot: dir,
    implRelPath: implPath,
    semantic: 'indicators',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-impl-export-extra');
  assert.equal(issue?.symbol, 'rogue_helper');
});

test('lintPythonExportContractFromPaths resolves package module from __init__.py（Run #61）', () => {
  const impl = 'def generate_signal():\n    return 0\n\n__all__ = ["generate_signal"]\n';
  const testPy = 'from signals import generate_signal\n';
  const issues = lintPythonExportContractFromPaths(
    [{ testPath: 'tests/test_signals.py', implPath: 'signals/__init__.py' }],
    (p) => (p.includes('test_') ? testPy : impl),
  );
  assert.equal(issues.length, 0);
});
