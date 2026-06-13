import { isNearMissKeyPair } from './CrossFileKeyContractLint';

/**
 * M24：活 `.stagent/CONTEXT.md` 词汇表（借鉴 skills `grill-with-docs` 的 CONTEXT-FORMAT
 * 与 `ubiquitous-language`）。
 *
 * 词汇表是「项目权威字典」：每个领域键名/术语只此一处定义。跨文件键名一致性 lint
 * （M21.1b）可把它当作 canonical 字典，发现 `tk_sku` vs glossary 中 `sku` 这类漂移。
 *
 * 纯函数：解析 / 序列化 / upsert / 查 canonical。引擎在 `stagent.glossary.enabled` 时读写。
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
}

const GLOSSARY_HEADING = '## Glossary';
// 形如 `- **term** — definition` 或 `- **term**: definition`
const ENTRY_LINE = /^-\s+\*\*([^*]+)\*\*\s*(?:[—:-]\s*)(.*)$/;

/** 从 CONTEXT.md 全文解析 Glossary 段（无该段返回 []）。 */
export function parseGlossary(markdown: string): GlossaryEntry[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === GLOSSARY_HEADING.toLowerCase());
  if (start < 0) {
    return [];
  }
  const out: GlossaryEntry[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      break; // 下一个标题，段结束
    }
    const m = ENTRY_LINE.exec(line.trim());
    if (m) {
      out.push({ term: m[1].trim(), definition: m[2].trim() });
    }
  }
  return out;
}

/** 序列化为 CONTEXT.md 的 Glossary 段（按 term 升序，稳定输出）。 */
export function serializeGlossary(entries: GlossaryEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.term.localeCompare(b.term));
  const body = sorted.map((e) => `- **${e.term}** — ${e.definition}`).join('\n');
  return `${GLOSSARY_HEADING}\n\n${body}\n`;
}

/** 新增或更新一个术语（term 大小写不敏感去重）。返回新数组（不修改入参）。 */
export function upsertGlossaryTerm(
  entries: GlossaryEntry[],
  term: string,
  definition: string,
): GlossaryEntry[] {
  const t = term.trim();
  const idx = entries.findIndex((e) => e.term.toLowerCase() === t.toLowerCase());
  if (idx < 0) {
    return [...entries, { term: t, definition: definition.trim() }];
  }
  const next = [...entries];
  next[idx] = { term: t, definition: definition.trim() };
  return next;
}

/**
 * 给定候选键名，若它精确等于某个 glossary 术语返回该术语；
 * 若它与某术语 near-miss（疑似漂移）返回 canonical 术语；否则 undefined。
 */
export function findCanonicalKey(entries: GlossaryEntry[], candidate: string): string | undefined {
  const exact = entries.find((e) => e.term === candidate);
  if (exact) {
    return exact.term;
  }
  let best: { term: string; distance: number } | undefined;
  for (const e of entries) {
    const { near, distance } = isNearMissKeyPair(candidate, e.term);
    if (near && (best === undefined || distance < best.distance)) {
      best = { term: e.term, distance };
    }
  }
  return best?.term;
}
