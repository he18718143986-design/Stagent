#!/usr/bin/env node
/**
 * engine-parity-matrix.mjs — 对比 stagent_vscode 引擎模块与 autoAI @stagent/core 缺口。
 *
 * 用法:
 *   node scripts/engine-parity-matrix.mjs
 *   node scripts/engine-parity-matrix.mjs --json artifacts/engine-parity.json
 *   node scripts/engine-parity-matrix.mjs --csv artifacts/engine-parity.csv
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const VSCODE_SRC = path.join(REPO_ROOT, 'stagent_vscode/src');
const CORE_SRC = path.join(REPO_ROOT, 'autoAI/packages/stagent-core/src');

const VSCODE_EXCLUDE_DIRS = new Set(['webview', 'test', 'sidebar', 'adapters']);
const VSCODE_EXCLUDE_FILES = new Set(['extension.ts']);

/** 扩展 / UI / VS Code 宿主专有条目，不计入 engine_gap。 */
const PARITY_EXEMPT_PATTERNS = [
  /^Extension/,
  /^StagentSidebar/,
  /^StagentTaskList/,
  /^StagentOnboarding/,
  /^StagentProfile/,
  /^StagentAiControls/,
  /^StagentSettings/,
  /^Webview/,
  /^WorkflowPanel/,
  /^LlmClient\.ts$/,
  /^OpenAiCompatibleLlm\.ts$/,
  /^EngineHostFactoryBuilder\.ts$/,
  /^EngineDiagnosticsOps\.ts$/,
  /^WorkflowEngineDiagnostics\.ts$/,
  /^WorkflowEngineHostRegistry\.ts$/,
  /^WorkflowEngineInternals\.ts$/,
  /^WorkflowEngineArtifactBridge\.ts$/,
  /^WorkflowEnginePersistenceBridge\.ts$/,
  /^WorkflowEngineOutputEdit\.ts$/,
  /^WorkflowEngineOutputHelper\.ts$/,
  /^WorkflowEngineWorkspaceLint\.ts$/,
  /^GrillAdaptiveFlow\.ts$/,
  /^GrillCodeExplore\.ts$/,
  /^MetricsCollector\.ts$/,
  /^SessionLogEvents\.ts$/,
  /^RuntimeBootstrap\.ts$/,
  /^KickoffFirstStage\.ts$/,
  /^DecisionReviewUi\.ts$/,
];

function isParityExempt(modulePath) {
  const base = path.basename(modulePath);
  return PARITY_EXEMPT_PATTERNS.some((re) => re.test(base));
}

function walkTsFiles(rootDir, opts = {}) {
  const { excludeDirs = new Set(), excludeFiles = new Set() } = opts;
  const results = [];

  function walk(dir, rel = '') {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (excludeDirs.has(ent.name)) continue;
        walk(path.join(dir, ent.name), relPath);
      } else if (ent.isFile() && ent.name.endsWith('.ts') && !excludeFiles.has(ent.name)) {
        results.push(relPath);
      }
    }
  }

  walk(rootDir);
  return results;
}

function normalizeKey(relPath) {
  // Flat root files: "WorkflowEngine.ts" -> "WorkflowEngine.ts"
  // Subdir files: "path-router/PathRouter.ts" -> "path-router/PathRouter.ts"
  return relPath.replace(/\\/g, '/');
}

function basenameKey(relPath) {
  return path.basename(relPath, '.ts');
}

function dirOf(relPath) {
  const d = path.dirname(relPath);
  return d === '.' ? '(root)' : d;
}

function importsVscode(absPath) {
  const content = fs.readFileSync(absPath, 'utf8');
  return /from\s+['"]vscode['"]|require\s*\(\s*['"]vscode['"]\)/.test(content);
}

function countTests(testDir, pattern) {
  if (!fs.existsSync(testDir)) return 0;
  let count = 0;
  for (const f of fs.readdirSync(testDir)) {
    if (f.endsWith('.test.ts') && f.toLowerCase().includes(pattern.toLowerCase())) {
      count++;
    }
  }
  return count;
}

function buildMatrix() {
  const vscodeFiles = walkTsFiles(VSCODE_SRC, {
    excludeDirs: VSCODE_EXCLUDE_DIRS,
    excludeFiles: VSCODE_EXCLUDE_FILES,
  }).map(normalizeKey);

  const coreFiles = walkTsFiles(CORE_SRC, {
    excludeDirs: new Set(['test']),
    excludeFiles: new Set(),
  }).map(normalizeKey);

  const coreByBasename = new Map();
  const coreByPath = new Set(coreFiles);
  for (const f of coreFiles) {
    const base = basenameKey(f);
    if (!coreByBasename.has(base)) coreByBasename.set(base, []);
    coreByBasename.get(base).push(f);
  }

  const rows = [];
  for (const vp of vscodeFiles.sort()) {
    const abs = path.join(VSCODE_SRC, vp);
    const base = basenameKey(vp);
    const coreHasExact = coreByPath.has(vp);
    const coreHasBasename = coreByBasename.has(base);
    const coreMatch = coreHasExact ? vp : coreHasBasename ? coreByBasename.get(base).join('|') : null;

    const vscodeOnly = !coreHasExact && !coreHasBasename;
    const parityExempt = vscodeOnly && isParityExempt(vp);
    rows.push({
      module_path: vp,
      directory: dirOf(vp),
      vscode_only: vscodeOnly,
      parity_exempt: parityExempt,
      engine_gap: vscodeOnly && !parityExempt,
      core_has: Boolean(coreMatch),
      core_match: coreMatch,
      match_kind: coreHasExact ? 'exact' : coreHasBasename ? 'basename' : 'missing',
      vscode_imports_vscode: importsVscode(abs),
      test_count: countTests(path.join(VSCODE_SRC, 'test'), base),
    });
  }

  // Core-only modules (not in vscode engine scope)
  const vscodeBasenames = new Set(vscodeFiles.map(basenameKey));
  const vscodePaths = new Set(vscodeFiles);
  const coreOnly = [];
  for (const cp of coreFiles.sort()) {
    const base = basenameKey(cp);
    if (!vscodePaths.has(cp) && !vscodeBasenames.has(base)) {
      coreOnly.push({ module_path: cp, directory: dirOf(cp) });
    }
  }

  const dirAgg = new Map();
  for (const r of rows) {
    const d = r.directory;
    if (!dirAgg.has(d)) {
      dirAgg.set(d, { directory: d, vscode_files: 0, core_has: 0, vscode_only: 0, vscode_imports_vscode: 0 });
    }
    const agg = dirAgg.get(d);
    agg.vscode_files++;
    if (r.core_has) agg.core_has++;
    if (r.vscode_only) agg.vscode_only++;
    if (r.vscode_imports_vscode) agg.vscode_imports_vscode++;
  }

  const vscodeOnlyRows = rows.filter((r) => r.vscode_only);
  const engineGapRows = rows.filter((r) => r.engine_gap);
  const summary = {
    generated_at: new Date().toISOString(),
    vscode_engine_files: vscodeFiles.length,
    core_engine_files: coreFiles.length,
    vscode_only_count: vscodeOnlyRows.length,
    parity_exempt_count: rows.filter((r) => r.parity_exempt).length,
    engine_gap_count: engineGapRows.length,
    core_has_count: rows.filter((r) => r.core_has).length,
    core_only_count: coreOnly.length,
    vscode_imports_vscode_count: rows.filter((r) => r.vscode_imports_vscode).length,
    directories: [...dirAgg.values()].sort((a, b) => b.vscode_only - a.vscode_only),
    rows,
    core_only: coreOnly,
  };

  return summary;
}

function toCsv(summary) {
  const header =
    'module_path,directory,vscode_only,parity_exempt,engine_gap,core_has,match_kind,vscode_imports_vscode,test_count,core_match';
  const lines = summary.rows.map((r) =>
    [
      r.module_path,
      r.directory,
      r.vscode_only,
      r.parity_exempt,
      r.engine_gap,
      r.core_has,
      r.match_kind,
      r.vscode_imports_vscode,
      r.test_count,
      r.core_match ?? '',
    ]
      .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v))
      .join(','),
  );
  return [header, ...lines].join('\n');
}

function printSummary(summary) {
  console.log('Engine Parity Matrix');
  console.log('====================');
  console.log(`vscode engine files:  ${summary.vscode_engine_files}`);
  console.log(`core engine files:    ${summary.core_engine_files}`);
  console.log(`core has (matched):   ${summary.core_has_count}`);
  console.log(`vscode only (gap):    ${summary.vscode_only_count}`);
  console.log(`parity exempt:        ${summary.parity_exempt_count}`);
  console.log(`engine gap:           ${summary.engine_gap_count}`);
  console.log(`core only (extra):    ${summary.core_only_count}`);
  console.log(`vscode imports vscode: ${summary.vscode_imports_vscode_count}`);
  console.log('');
  console.log('Top gap directories (vscode_only > 0):');
  for (const d of summary.directories.filter((x) => x.vscode_only > 0).slice(0, 25)) {
    console.log(`  ${d.directory.padEnd(30)} vscode=${d.vscode_files} gap=${d.vscode_only} has=${d.core_has}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  let jsonOut = null;
  let csvOut = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && args[i + 1]) jsonOut = path.resolve(args[++i]);
    if (args[i] === '--csv' && args[i + 1]) csvOut = path.resolve(args[++i]);
  }

  const summary = buildMatrix();
  printSummary(summary);

  const artifactsDir = path.join(REPO_ROOT, 'autoAI/artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const defaultJson = path.join(artifactsDir, 'engine-parity.json');
  const defaultCsv = path.join(artifactsDir, 'engine-parity.csv');

  fs.writeFileSync(jsonOut ?? defaultJson, JSON.stringify(summary, null, 2));
  fs.writeFileSync(csvOut ?? defaultCsv, toCsv(summary));
  console.log('');
  console.log(`Wrote ${jsonOut ?? defaultJson}`);
  console.log(`Wrote ${csvOut ?? defaultCsv}`);
}

main();
