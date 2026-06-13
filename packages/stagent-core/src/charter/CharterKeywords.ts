/** 从规则/问题文本提取用于语义匹配的 keyword 集合（中英混排）。 */
export function extractKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (token: string) => {
    const t = token.toLowerCase().trim();
    if (t.length < 2 || seen.has(t)) {
      return;
    }
    seen.add(t);
    out.push(t);
  };

  for (const m of text.match(/[a-z][a-z0-9_.-]{1,}/gi) ?? []) {
    push(m);
  }
  for (const run of text.match(/\p{Script=Han}{2,}/gu) ?? []) {
    push(run);
    if (run.length > 4) {
      push(run.slice(0, 4));
    }
  }
  const spaced = text
    .toLowerCase()
    .replace(/[【】\[\]()（）「」『』]/g, ' ')
    .replace(/[^\p{L}\p{N}\s#./_-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  for (const t of spaced) {
    push(t);
  }
  return out;
}

/** 规则 keywords 在问题文本中的子串命中率。 */
export function keywordOverlapScore(question: string, ruleKeywords: string[]): number {
  if (ruleKeywords.length === 0) {
    return 0;
  }
  const q = question.toLowerCase();
  let hits = 0;
  for (const k of ruleKeywords) {
    if (k.length >= 2 && q.includes(k.toLowerCase())) {
      hits++;
    }
  }
  const englishHits = ruleKeywords.filter(
    (k) => /^[a-z]/i.test(k) && q.includes(k.toLowerCase()),
  ).length;
  if (englishHits >= 2) {
    return Math.min(1, englishHits / 2);
  }
  const denom = Math.min(ruleKeywords.length, 6);
  return hits / Math.max(denom, 1);
}
