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
    if (aSubset || bSubset) {
      return { near: true, distance: dist };
    }
  }
  return { near: false, distance: dist };
}
