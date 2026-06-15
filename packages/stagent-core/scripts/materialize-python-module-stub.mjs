#!/usr/bin/env node
/**
 * 从实例 .wf-state.json 读取切片 decide 的 decisionArtifacts.modules，
 * 物化最小 Python stub 包（NotImplementedError），供 RED verify_imports --strict。
 *
 * 用法：node materialize-python-module-stub.mjs <semantic>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveModuleExports } = require(
  path.join(__dirname, '../dist/commitment/decisionArtifactsSchema.js'),
);

const GLOBAL_DECIDE_ID = 'stage_decide_architecture_overview';
const ARTIFACTS_KEY = 'decisionArtifacts';

function usage() {
  console.error('usage: node materialize-python-module-stub.mjs <semantic>');
  process.exit(2);
}

function sliceDecisionRecordFromRuntime(sliceRt) {
  const approved = sliceRt?.approvedDecisionRecord?.trim();
  if (approved) {
    return approved;
  }
  const raw = sliceRt?.outputs?.decisionRecord;
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function readArtifactsFromInstance(cwd, semantic) {
  const instancesRoot = path.join(cwd, '.stagent', 'instances');
  if (!fs.existsSync(instancesRoot)) {
    return { slice: null, global: null, sliceDecisionRecord: undefined, error: 'no .stagent/instances directory' };
  }
  const dirs = fs
    .readdirSync(instancesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let best = null;
  let bestMtime = 0;
  for (const id of dirs) {
    const statePath = path.join(instancesRoot, id, '.wf-state.json');
    if (!fs.existsSync(statePath)) continue;
    const stat = fs.statSync(statePath);
    if (stat.mtimeMs < bestMtime) continue;
    bestMtime = stat.mtimeMs;
    try {
      const inst = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const runtimes = Array.isArray(inst.stageRuntimes) ? inst.stageRuntimes : [];
      const sliceRt = runtimes.find((r) => r.stageId === `stage_decide_${semantic}`);
      const globalRt = runtimes.find((r) => r.stageId === GLOBAL_DECIDE_ID);
      best = {
        slice: sliceRt?.outputs?.[ARTIFACTS_KEY] ?? null,
        global: globalRt?.outputs?.[ARTIFACTS_KEY] ?? null,
        sliceDecisionRecord: sliceDecisionRecordFromRuntime(sliceRt),
      };
    } catch {
      // try next
    }
  }
  if (!best) {
    return { slice: null, global: null, sliceDecisionRecord: undefined, error: 'no readable .wf-state.json' };
  }
  return best;
}

function implWritePath(semantic) {
  if (semantic === 'main') {
    return 'main.py';
  }
  return path.join(semantic, '__init__.py');
}

/** 约定俗成的 CLI 入口名（main/run/cli）：始终是函数（而非以 semantic 同名判为类）。 */
const MAIN_ENTRY_NAMES = new Set(['main', 'run', 'cli']);

function buildStubSource(semantic, exports) {
  const lines = exports.map((name) => {
    // 入口名（main/run/cli）为函数；其余「与模块同名或 PascalCase」为类。
    if (!MAIN_ENTRY_NAMES.has(name) && (name === semantic || /^[A-Z]/.test(name))) {
      return `class ${name}:\n    def __init__(self, *args, **kwargs):\n        raise NotImplementedError("stub")`;
    }
    return `def ${name}(*args, **kwargs):\n    raise NotImplementedError("stub")`;
  });
  const all = JSON.stringify(exports);
  return `${lines.join('\n\n')}\n\n__all__ = ${all}\n`;
}

function main() {
  const semantic = process.argv[2]?.trim();
  if (!semantic) usage();

  const cwd = process.cwd();
  const { slice, global, sliceDecisionRecord, error } = readArtifactsFromInstance(cwd, semantic);
  let exports = resolveModuleExports(semantic, slice, global, sliceDecisionRecord);
  if (!exports?.length) {
    // 子任务 1d (d)：main 切片契约常仅声明 `main`，被 pruneExportNoise 当噪声剔空 → 旧逻辑 exit 1，
    // 阻断 workflow。main 是程序入口，缺声明时默认物化入口函数 stub（main），避免假阻断。
    if (semantic === 'main') {
      exports = ['main'];
    } else {
      console.error(
        `materialize-python-module-stub: no exports for "${semantic}" in decisionArtifacts (${error ?? 'missing modules[]'})`,
      );
      process.exit(1);
    }
  }

  const relPath = implWritePath(semantic);
  const absPath = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const body = buildStubSource(semantic, exports);
  fs.writeFileSync(absPath, body, 'utf8');
  console.log(`materialized stub: ${relPath} exports=${exports.join(',')}`);
}

main();
