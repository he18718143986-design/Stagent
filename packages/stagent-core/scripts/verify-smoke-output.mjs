#!/usr/bin/env node
/**
 * 真实集成冒烟产出断言（ADR-0008：把「真实集成冒烟」做成工作流内阶段）。
 *
 * 在主入口运行**之后**执行：校验任务声明的 JSON 产出存在且**非平凡**（不是全零/空值），
 * 捕获「空心绿」——`python main.py` exit 0 但 main() 从未被调用（缺 if __name__）、
 * 未创建输出目录、宽 except 吞错、或数据/管道 bug 导致产出无意义。
 *
 * 断言对象（按优先级）：
 *   1) config.yaml 中 key 含 out/summary/result/report/export 的 *.json 声明值。
 *   2) 工作区常见产出文件（summary.json / output/summary.json / output.json ...）。
 *   3) 都没有 → 不断言（仅以主入口 exit 0 为底线），退出 0 避免对无产出任务造成假失败。
 *
 * 用法：node scripts/verify-smoke-output.mjs            （cwd = 工作区根）
 * 退出码：0=通过（或无可断言产出），1=断言失败（产出缺失/非法/平凡）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.venv',
  'venv',
  '.pytest_cache',
  '.stagent',
  '__pycache__',
  'node_modules',
  '.git',
  'site-packages',
]);

/**
 * 「平凡产出」判定（与 scripts/headless/lib/mvp-acceptance.mjs 同源）：递归判断 JSON 值
 * 是否全为初始/零值——数字为 0、字符串为空、布尔为 false、null、空数组/对象，或元素全平凡。
 */
function isTrivialJsonValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean') return value === false;
  if (Array.isArray(value)) return value.every(isTrivialJsonValue);
  if (typeof value === 'object') {
    const vals = Object.values(value);
    return vals.length === 0 || vals.every(isTrivialJsonValue);
  }
  return false;
}

function findFileByBasename(dir, basename) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      const found = findFileByBasename(full, basename);
      if (found) return found;
    } else if (name === basename) {
      return full;
    }
  }
  return null;
}

/** 解析产出文件真实路径：① 字面路径 ② 工作区内递归搜同名文件（模型可能放进子目录）。 */
function resolveArtifact(ws, rel) {
  const direct = path.join(ws, rel);
  if (fs.existsSync(direct)) return direct;
  return findFileByBasename(ws, path.basename(rel));
}

/** 从 config.yaml 抽取「输出类」键的 *.json 声明路径。 */
function declaredOutputJsonPaths(ws) {
  const cfg = path.join(ws, 'config.yaml');
  const paths = new Set();
  if (fs.existsSync(cfg)) {
    let text = '';
    try {
      text = fs.readFileSync(cfg, 'utf8');
    } catch {
      text = '';
    }
    const re = /^\s*([\w.-]+)\s*:\s*['"]?([^'"\n#]+\.json)['"]?/gim;
    for (const m of text.matchAll(re)) {
      const key = String(m[1]).toLowerCase();
      const val = String(m[2]).trim();
      if (/out|summary|result|report|export/.test(key)) {
        paths.add(val);
      }
    }
  }
  return [...paths];
}

const FALLBACK_OUTPUTS = [
  'summary.json',
  'output/summary.json',
  'output.json',
  'result.json',
  'out/summary.json',
  'output/result.json',
];

const ws = process.cwd();
let candidates = declaredOutputJsonPaths(ws);
if (candidates.length === 0) {
  candidates = FALLBACK_OUTPUTS.filter((f) => fs.existsSync(path.join(ws, f)));
}

if (candidates.length === 0) {
  console.log('smoke-output: 无声明的 JSON 产出可断言，跳过产出断言（已校验主入口 exit 0）。');
  process.exit(0);
}

const errors = [];
for (const rel of candidates) {
  const abs = resolveArtifact(ws, rel);
  if (!abs || !fs.existsSync(abs) || fs.statSync(abs).size === 0) {
    errors.push(
      `产出缺失/为空：${rel}（主入口可能未真正执行业务路径——缺 if __name__ 调 main()、未创建输出目录、或错误被宽 except 吞掉）`,
    );
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    errors.push(`产出非合法 JSON：${rel}（${String(e).slice(0, 120)}）`);
    continue;
  }
  if (isTrivialJsonValue(parsed)) {
    errors.push(`产出无意义（全为零/空值）：${rel}（疑似空心绿：数据未导入或管道未生效）`);
  }
}

if (errors.length > 0) {
  console.error('smoke-output 断言失败（ADR-0008 真实集成冒烟）：');
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`smoke-output: 产出非平凡，校验通过（${candidates.join(', ')}）。`);
process.exit(0);
