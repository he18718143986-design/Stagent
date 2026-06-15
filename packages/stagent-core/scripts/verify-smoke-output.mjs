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

/** 从 config.yaml 抽取首个 *.csv 输入路径（用于 status 保真断言）。 */
function declaredCsvPath(ws) {
  const cfg = path.join(ws, 'config.yaml');
  if (!fs.existsSync(cfg)) return null;
  let text = '';
  try {
    text = fs.readFileSync(cfg, 'utf8');
  } catch {
    return null;
  }
  const m = /^\s*[\w.-]*(?:csv|input|data)[\w.-]*\s*:\s*['"]?([^'"\n#]+\.csv)['"]?/im.exec(text);
  return m ? m[1].trim() : null;
}

/** 读取 CSV 的 status 列分布（非空值 → 出现次数）。无 status 列返回 null。 */
function csvStatusDistribution(ws, csvRel) {
  const abs = resolveArtifact(ws, csvRel);
  if (!abs || !fs.existsSync(abs)) return null;
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const statusIdx = header.indexOf('status');
  if (statusIdx < 0) return null;
  const dist = {};
  let rows = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    rows += 1;
    const v = (cells[statusIdx] ?? '').trim();
    if (v) dist[v] = (dist[v] ?? 0) + 1;
  }
  return { dist, rows };
}

/** 在 JSON 里找「状态直方图」对象：值全为整数的扁平对象（顶层或一层嵌套）。 */
function findIntHistogram(value) {
  const isFlatIntObj = (o) =>
    o && typeof o === 'object' && !Array.isArray(o) &&
    Object.keys(o).length > 0 &&
    Object.values(o).every((v) => typeof v === 'number' && Number.isInteger(v));
  if (isFlatIntObj(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const v of Object.values(value)) {
      if (isFlatIntObj(v)) return v;
    }
  }
  return null;
}

/**
 * status 保真断言（子任务 1d）：CSV 的 status 列含多种合法值时，产出的状态直方图必须**反映**之，
 * 而非把所有行塌缩到单一状态（如 pipeline 丢弃 status → 全计 todo）。
 * 保守触发：① CSV 有 status 列且 ≥2 个不同非空值；② 产出含状态直方图；③ 直方图各值之和 == CSV 行数
 *（完整划分、无过滤/无非法行——种子 fixture 全合法时成立）。命中后：CSV 出现且为直方图键的状态若计数 0 → 判红。
 * 返回 error 字符串或 null。
 */
function assertStatusFidelity(ws, parsedSummary) {
  const csvRel = declaredCsvPath(ws);
  if (!csvRel) return null;
  const csv = csvStatusDistribution(ws, csvRel);
  if (!csv) return null;
  const distinct = Object.keys(csv.dist);
  if (distinct.length < 2) return null;
  const hist = findIntHistogram(parsedSummary);
  if (!hist) return null;
  const sum = Object.values(hist).reduce((a, b) => a + b, 0);
  if (sum !== csv.rows) return null; // 有过滤/非法行 → 不确定，跳过（避免误判）
  const dropped = distinct.filter((s) => s in hist && hist[s] === 0);
  if (dropped.length > 0) {
    return `status 未透传：CSV 含 status=${dropped.join('/')}（各 ${dropped.map((s) => csv.dist[s]).join('/')} 行），但产出统计该状态计数为 0（疑似导入时丢弃了 CSV 的 status 字段）`;
  }
  return null;
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
    continue;
  }
  const statusErr = assertStatusFidelity(ws, parsed);
  if (statusErr) {
    errors.push(`${statusErr}（${rel}）`);
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
