import * as fs from 'fs';
import * as path from 'path';

/** 最小 OHLCV CSV，供 smoke 前种子数据兜底（无法从代码推断列时使用）。 */
export const MINIMAL_KLINE_CSV = `timestamp,open,high,low,close,volume
2023-01-02 09:30:00,4000,4010,3990,4005,1000
2023-01-02 09:31:00,4005,4015,3995,4010,1100
`;

/** 扫描时跳过的目录（第三方/缓存），避免推断到无关代码。 */
const PY_SCAN_SKIP_DIRS = new Set([
  '.venv',
  'venv',
  '.pytest_cache',
  '__pycache__',
  'node_modules',
  '.git',
  'site-packages',
  '.stagent',
]);

/** 从 config.yaml 文本抽取相对/绝对 .csv 路径引用。 */
export function extractCsvPathsFromYaml(yamlText: string): string[] {
  const paths = new Set<string>();
  const re = /['"]?(\.?\/?[\w./-]+\.csv)['"]?/gi;
  for (const m of yamlText.matchAll(re)) {
    const p = m[1]?.trim();
    if (p && !/^https?:/i.test(p)) {
      paths.add(p.replace(/\\/g, '/'));
    }
  }
  return [...paths];
}

function collectProjectPyText(workspaceRoot: string): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (PY_SCAN_SKIP_DIRS.has(name)) continue;
        walk(full);
      } else if (name.endsWith('.py') && st.size > 0) {
        try {
          parts.push(fs.readFileSync(full, 'utf8'));
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(workspaceRoot);
  return parts.join('\n');
}

/**
 * 从代码中推断 CSV 列名：匹配 `row["x"]` / `row['x']` / `row.get("x")` 等 DictReader 字段访问，
 * 按出现顺序去重返回。
 */
export function inferCsvColumns(pyText: string): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  const re = /\brow(?:\.get\(\s*|\s*\[\s*)['"]([A-Za-z_][\w]*)['"]/g;
  for (const m of pyText.matchAll(re)) {
    const c = m[1];
    if (c && !seen.has(c)) {
      seen.add(c);
      cols.push(c);
    }
  }
  return cols;
}

/**
 * 推断 status/state 列的全部合法值：只认 LHS 名含 STATUS/STATE/VALID/ALLOWED 的字符串集合赋值
 * （如 `VALID_STATUSES = {"todo","in_progress","done","cancelled"}`），避免误取 `__all__` 等无关集合。
 * 返回按出现序去重的值数组（空 = 推断不到）。
 */
export function inferEnumValues(pyText: string): string[] {
  const assignRe =
    /\b\w*(?:STATUS|STATE|VALID|ALLOWED|CHOICES)\w*\s*[:=]\s*[{[(]([^}\])]*)[)\]}]/gi;
  for (const m of pyText.matchAll(assignRe)) {
    const values: string[] = [];
    const seen = new Set<string>();
    for (const v of (m[1] ?? '').matchAll(/['"]([\w-]+)['"]/g)) {
      const val = v[1];
      if (val && !seen.has(val)) {
        seen.add(val);
        values.push(val);
      }
    }
    if (values.length > 0) {
      return values;
    }
  }
  return [];
}

/**
 * status/state 列首个合法值（兼容旧调用）。找不到返回 undefined（调用方对 status 列留空）。
 */
export function inferFirstEnumValue(pyText: string): string | undefined {
  return inferEnumValues(pyText)[0];
}

const NUMERIC_COL_RE = /^(priority|level|rank|score|count|qty|quantity|num|amount|age|order|index|id|volume|open|high|low|close|price|value)$/i;
const DATE_COL_RE = /^(date|time|timestamp|datetime|created|updated)$/i;
const STATUS_COL_RE = /^(status|state|type|kind|category)$/i;
const TEXT_COL_RE = /^(title|name|description|label|text|summary|note|comment|message)$/i;

function sampleValueForColumn(col: string, rowIndex: number, enumValues: string[]): string {
  if (DATE_COL_RE.test(col)) {
    return `2023-01-0${rowIndex + 1} 09:3${rowIndex}:00`;
  }
  if (NUMERIC_COL_RE.test(col)) {
    // priority 类常被校验 1..5；用 2/3 等安全值。
    if (/^priority$/i.test(col)) return String(2 + (rowIndex % 4));
    return String(100 + rowIndex);
  }
  if (STATUS_COL_RE.test(col)) {
    // 子任务 1d：按行**轮换**全部枚举值，使种子覆盖多种 status——这样「正确透传 status 的实现」
    // 产出多状态统计，而「丢弃 status 的实现」统计单一状态，被 verify-smoke-output 的状态保真断言判红。
    // 推断不到枚举则留空（多数实现把空状态默认为初始态）。
    return enumValues.length > 0 ? enumValues[rowIndex % enumValues.length]! : '';
  }
  if (TEXT_COL_RE.test(col)) {
    return `Sample ${rowIndex + 1}`;
  }
  return `value${rowIndex + 1}`;
}

/**
 * 用推断出的列 + 启发式值构造种子 CSV。行数默认覆盖全部枚举值（≥2，封顶 4 以保 priority 1..5 合法），
 * 使 status 列出现多种合法值（供状态保真冒烟断言）。
 */
export function buildSeedCsv(columns: string[], pyText: string, rows?: number): string {
  const enumValues = inferEnumValues(pyText);
  const hasStatusCol = columns.some((c) => STATUS_COL_RE.test(c));
  const rowCount =
    rows ?? (hasStatusCol && enumValues.length > 1 ? Math.min(Math.max(enumValues.length, 2), 4) : 2);
  const header = columns.join(',');
  const body = Array.from({ length: rowCount }, (_, i) =>
    columns.map((c) => sampleValueForColumn(c, i, enumValues)).join(','),
  );
  return `${header}\n${body.join('\n')}\n`;
}

/**
 * 为单个缺失 CSV 选择种子内容：优先从代码推断列（schema 感知，避免「用了别的任务的种子」），
 * 推断不到列时回落最小 OHLCV fixture。
 */
export function resolveSeedCsvContent(workspaceRoot: string): string {
  const pyText = collectProjectPyText(workspaceRoot);
  const columns = inferCsvColumns(pyText);
  if (columns.length === 0) {
    return MINIMAL_KLINE_CSV;
  }
  return buildSeedCsv(columns, pyText);
}

/**
 * smoke 前：为 config.yaml 引用的缺失 CSV 写入与任务字段一致的最小 fixture（幂等）。
 * 种子内容按工作区代码推断列（ADR-0009：禁止复用其它任务的种子，如把期货 K 线塞进 todo 任务）。
 * @returns 新创建文件的相对路径列表
 */
export function seedSmokeCsvFixtures(workspaceRoot: string, yamlRelPath = 'config.yaml'): string[] {
  const yamlPath = path.join(workspaceRoot, yamlRelPath);
  if (!fs.existsSync(yamlPath)) {
    return [];
  }
  const yaml = fs.readFileSync(yamlPath, 'utf8');
  const missing = extractCsvPathsFromYaml(yaml).filter((rel) => {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    return !fs.existsSync(abs);
  });
  if (missing.length === 0) {
    return [];
  }
  // 仅在确有缺失时推断一次种子内容（schema 感知）。
  const content = resolveSeedCsvContent(workspaceRoot);
  const created: string[] = [];
  for (const rel of missing) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    created.push(rel);
  }
  return created;
}
