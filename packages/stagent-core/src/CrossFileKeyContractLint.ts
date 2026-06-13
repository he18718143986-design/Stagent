/**
 * M21.1b：跨文件键名一致性 lint（运行期，test_run 前）。
 *
 * 背景：reader.py 产出 dict 键 `tk_sku`/`stock`，analyzer.py 却 `row.get('sku')`/`row.get('expected_stock')`；
 * fetcher mock 读 `availability`/`delivery_date`，而 mock_data.json 写 `stock_status`/`estimated_delivery_date`。
 * 这类「产出键 vs 消费键 近似但不一致」的契约漂移，流程能跑通但结果全错（空心成功）。
 *
 * 本模块为纯函数：输入若干已落盘文件内容（.py / .json / .yaml），抽取「产出键集合」与「消费键集合」，
 * 检测跨文件的 near-miss（编辑距离 ≤ 2 或 token 子集关系），输出 warning。warning-only，不阻断执行。
 */

export interface ProjectFile {
  path: string;
  content: string;
}

export interface KeyMismatch {
  consumedKey: string;
  consumedIn: string;
  /** 最相近的已产出键 */
  nearestProducedKey: string;
  producedIn: string;
  distance: number;
}

export interface CrossFileKeyLintResult {
  warnings: string[];
  mismatches: KeyMismatch[];
}

const PY_OR_JSON_LIKE = /\.(py|json|ya?ml)$/i;

/** 字符串字面量中作为 dict 键 / JSON 键出现的标识符（产出侧） */
const PRODUCED_KEY_PATTERNS: RegExp[] = [
  // python dict literal:  'asin': ...   "tk_sku": ...
  /['"]([a-zA-Z_][a-zA-Z0-9_]{1,40})['"]\s*:/g,
];

/** 消费侧：.get('key') / ['key'] / .get("key", ...) */
const CONSUMED_KEY_PATTERNS: RegExp[] = [
  /\.get\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]{1,40})['"]/g,
  /\[\s*['"]([a-zA-Z_][a-zA-Z0-9_]{1,40})['"]\s*\]/g,
];

/** 太通用、跨文件天然共享、误报率高的键名（跳过） */
const STOPWORD_KEYS = new Set([
  'type',
  'name',
  'id',
  'key',
  'value',
  'data',
  'error',
  'message',
  'status',
  'result',
  'results',
  'path',
  'mode',
  'config',
  'url',
  'method',
  'headers',
  'timeout',
  'level',
  'detail',
  'details',
  'items',
  'list',
  'count',
  'total',
  'index',
  'label',
  'title',
  'text',
  'format',
  'encoding',
  'default',
  'self',
  'cls',
  'args',
  'kwargs',
]);

function collectKeys(content: string, patterns: RegExp[]): Set<string> {
  const out = new Set<string>();
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const key = m[1];
      if (key && !STOPWORD_KEYS.has(key) && key.length >= 3) {
        out.add(key);
      }
    }
  }
  return out;
}

/** Levenshtein 距离（小串，足够用） */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) {
    prev[j] = j;
  }
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) {
      prev[j] = cur[j];
    }
  }
  return prev[n];
}

function tokenize(key: string): Set<string> {
  return new Set(
    key
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[_\s]+/)
      .filter((t) => t.length >= 2),
  );
}

/** 两个键是否「语义近似但不相等」：编辑距离 ≤ 2，或共享 token 子集关系（如 stock vs stock_status / sku vs tk_sku） */
export function isNearMissKeyPair(a: string, b: string): { near: boolean; distance: number } {
  if (a === b) {
    return { near: false, distance: 0 };
  }
  const dist = levenshtein(a, b);
  if (dist <= 2) {
    return { near: true, distance: dist };
  }
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size > 0 && tb.size > 0) {
    const aSubset = [...ta].every((t) => tb.has(t));
    const bSubset = [...tb].every((t) => ta.has(t));
    // 一方的 token 完全包含于另一方（stock ⊂ {stock,status}；sku ⊂ {tk,sku}）→ 近似漂移
    if (aSubset || bSubset) {
      return { near: true, distance: dist };
    }
  }
  return { near: false, distance: dist };
}

/**
 * 跨文件检测：某文件「消费」的键，在另一文件「产出」的键里没有精确匹配，
 * 却存在一个 near-miss 的已产出键 → 高度疑似契约漂移。
 */
export function lintCrossFileKeyContract(
  files: ProjectFile[],
  canonicalKeys?: string[],
): CrossFileKeyLintResult {
  const relevant = files.filter((f) => PY_OR_JSON_LIKE.test(f.path) && f.content.trim().length > 0);

  const producedByFile = new Map<string, Set<string>>();
  const allProduced = new Map<string, string>(); // key -> first producing file
  for (const f of relevant) {
    const produced = collectKeys(f.content, PRODUCED_KEY_PATTERNS);
    producedByFile.set(f.path, produced);
    for (const k of produced) {
      if (!allProduced.has(k)) {
        allProduced.set(k, f.path);
      }
    }
  }

  const mismatches: KeyMismatch[] = [];
  const seen = new Set<string>();
  for (const f of relevant) {
    const consumed = collectKeys(f.content, CONSUMED_KEY_PATTERNS);
    for (const ck of consumed) {
      if (allProduced.has(ck)) {
        continue; // 精确匹配，无漂移
      }
      // 找最相近的已产出键
      let best: { key: string; file: string; distance: number } | undefined;
      for (const [pk, pfile] of allProduced) {
        if (pfile === f.path) {
          continue; // 同文件内产出/消费暂不计（聚焦跨文件）
        }
        const { near, distance } = isNearMissKeyPair(ck, pk);
        if (near && (best === undefined || distance < best.distance)) {
          best = { key: pk, file: pfile, distance };
        }
      }
      if (best) {
        const dedupe = `${ck}@${f.path}->${best.key}@${best.file}`;
        if (seen.has(dedupe)) {
          continue;
        }
        seen.add(dedupe);
        mismatches.push({
          consumedKey: ck,
          consumedIn: f.path,
          nearestProducedKey: best.key,
          producedIn: best.file,
          distance: best.distance,
        });
      }
    }
  }

  const warnings = mismatches.map(
    (m) =>
      `contract:cross-file-key-mismatch:${m.consumedIn} 消费键 '${m.consumedKey}' 与 ${m.producedIn} 产出键 '${m.nearestProducedKey}' 疑似不一致`,
  );

  // M24：若提供 CONTEXT.md 词汇表（canonical 键名），额外检测「键名漂移出权威字典」。
  if (canonicalKeys && canonicalKeys.length > 0) {
    const canonSet = new Set(canonicalKeys);
    const flagged = new Set<string>();
    for (const f of relevant) {
      const all = new Set<string>([
        ...collectKeys(f.content, PRODUCED_KEY_PATTERNS),
        ...collectKeys(f.content, CONSUMED_KEY_PATTERNS),
      ]);
      for (const k of all) {
        if (canonSet.has(k) || flagged.has(k)) {
          continue;
        }
        for (const canon of canonicalKeys) {
          if (isNearMissKeyPair(k, canon).near) {
            flagged.add(k);
            warnings.push(
              `contract:non-canonical-key:${f.path} 键 '${k}' 偏离 CONTEXT.md 权威术语 '${canon}'`,
            );
            break;
          }
        }
      }
    }
  }

  return { warnings, mismatches };
}
