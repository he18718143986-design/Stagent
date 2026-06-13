#!/usr/bin/env node
/**
 * 校验 Python 测试文件 import（STAGENT-PRD §5.6#6）。
 *
 * 默认（pre-impl）：测试文件须存在；stdlib/第三方（SSOT 白名单）跳过；
 * 项目内待实现模块 **不** hard-fail（由 test_run + fix 链承接）。
 *
 * --strict：另要求项目内顶层 module 已在 workspace 落盘（M5 stub 后可选档）。
 *
 * 用法：node scripts/verify-python-test-imports.mjs [--strict] <test-file> [...]
 * 退出码 0=通过，1=失败，2=用法错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import externalRoots from './python-external-module-roots.json' with { type: 'json' };

const FROM_IMPORT_RE = /^\s*from\s+([a-zA-Z_][\w.]*)\s+import\s+/gm;
const IMPORT_RE = /^\s*import\s+([a-zA-Z_][\w.]*)\s*$/gm;

/** 标准库 + 常见第三方：与 pythonExternalModules.ts 共享 SSOT */
const EXTERNAL_MODULE_ROOTS = new Set(externalRoots.map((r) => r.toLowerCase()));

function parseArgs(argv) {
  const files = [];
  let strict = false;
  for (const arg of argv) {
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
    files.push(arg);
  }
  return { strict, files };
}

function isExternalModuleRoot(name) {
  return EXTERNAL_MODULE_ROOTS.has(name.split('.')[0].toLowerCase());
}

function extractModuleImports(content) {
  const mods = new Set();
  FROM_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = FROM_IMPORT_RE.exec(content)) !== null) {
    const mod = m[1];
    if (mod && !mod.startsWith('.')) {
      mods.add(mod.split('.')[0]);
    }
  }
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const mod = m[1];
    if (mod && !mod.startsWith('.')) {
      mods.add(mod.split('.')[0]);
    }
  }
  return [...mods];
}

function resolveModule(workspaceRoot, mod) {
  const candidates = [
    path.join(workspaceRoot, `${mod}.py`),
    path.join(workspaceRoot, mod, '__init__.py'),
    path.join(workspaceRoot, 'src', `${mod}.py`),
    path.join(workspaceRoot, 'src', mod, '__init__.py'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/**
 * @param {{ strict: boolean }} opts
 */
function checkTestFile(testPath, workspaceRoot, opts) {
  const abs = path.resolve(testPath);
  if (!fs.existsSync(abs)) {
    return { file: testPath, missing: [`<file not found: ${testPath}>`], skipped: [] };
  }
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { file: testPath, missing: [`<unreadable: ${msg}>`], skipped: [] };
  }

  const missing = [];
  const skipped = [];
  for (const mod of extractModuleImports(content)) {
    if (isExternalModuleRoot(mod)) {
      continue;
    }
    if (!opts.strict) {
      skipped.push(mod);
      continue;
    }
    if (!resolveModule(workspaceRoot, mod)) {
      missing.push(mod);
    }
  }
  return { file: testPath, missing, skipped };
}

const { strict, files } = parseArgs(process.argv.slice(2));
if (files.length === 0) {
  console.error('usage: node scripts/verify-python-test-imports.mjs [--strict] <test-file> [...]');
  process.exit(2);
}

const workspaceRoot = process.cwd();
const results = files.map((f) => checkTestFile(f, workspaceRoot, { strict }));
const allMissing = results.flatMap((r) => r.missing.map((m) => `${r.file}: ${m}`));

if (allMissing.length > 0) {
  console.error(strict ? 'Missing Python modules (--strict):' : 'verify_imports failed:');
  for (const line of allMissing) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

const skippedProject = results.flatMap((r) =>
  r.skipped.map((m) => `${r.file}: ${m} (project module, pre-impl soft-skip)`),
);
if (skippedProject.length > 0 && !strict) {
  console.log('Pre-impl soft-skip (project modules deferred to test_run):');
  for (const line of skippedProject) {
    console.log(`  ${line}`);
  }
}

const mode = strict ? 'strict' : 'pre-impl';
console.log(`All Python test import checks passed (${mode}).`);
process.exit(0);
