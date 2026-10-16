/**
 * 记录、规则与规则区块（规格 §10、D5–D9）。
 *
 * - 记录：record.saved（decision / pitfall，带标签），record.deleted 需 delete 授权；
 * - 规则：rule.proposed → rule.accepted → rule.retired；同一标签的 pitfall 达到 2 条且该标签还没有规则时，提议起草一条；
 * - 规则区块：CLAUDE.md 与 .cursor/rules/stagent.mdc 中由 `<!-- stagent:rules -->` 与 `<!-- /stagent:rules -->` 包裹的部分，
 *   内容由账本里已接受的规则生成；服务启动时校验是否偏离；
 * - 度量：规则生效后同标签 pitfall 的数量；生效后已有 ≥ 10 次合并、同类坑仍在出现，或你判断满足失效条件时，提示退役。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex } from '../ledger/hash.js';
import type { IsoTime, LedgerLine, RecordKind, RecordScope } from '../ledger/types.js';

export const RULES_BLOCK_START = '<!-- stagent:rules -->';
export const RULES_BLOCK_END = '<!-- /stagent:rules -->';
export const RULE_FILES = ['CLAUDE.md', join('.cursor', 'rules', 'stagent.mdc')];
export const PITFALLS_PER_RULE = 2;
export const RETIRE_AFTER_CHANGES = 10;

export interface RecordView {
  recordId: string;
  kind: RecordKind;
  tags: string[];
  scope: RecordScope;
  title: string;
  body: string;
  changeId?: string;
  at: IsoTime;
}

export type RuleStatus = 'proposed' | 'accepted' | 'retired';

export interface RuleView {
  ruleId: string;
  text: string;
  appliesWhen: string;
  expiresWhen: string;
  tags: string[];
  status: RuleStatus;
  proposedAt: IsoTime;
  acceptedAt: IsoTime | null;
  /** 生效后同标签的 pitfall 数。 */
  pitfallsAfter: number;
  /** 生效后合并的改动数。 */
  changesSince: number;
  suggestRetire: boolean;
}

export interface RecordsProjection {
  records: RecordView[];
  rules: RuleView[];
  /** 已有 ≥ 2 条 pitfall、却还没有（提议中或已接受的）规则的标签。 */
  tagsNeedingRule: string[];
}

export function projectRecords(lines: readonly LedgerLine[]): RecordsProjection {
  const records = new Map<string, RecordView>();
  const rules = new Map<string, RuleView>();
  const merges: IsoTime[] = [];
  for (const { event: e, at } of lines) {
    switch (e.type) {
      case 'record.saved':
        records.set(e.recordId, {
          recordId: e.recordId,
          kind: e.kind,
          tags: e.tags,
          scope: e.scope,
          title: e.title ?? '',
          body: e.body ?? '',
          ...(e.changeId ? { changeId: e.changeId } : {}),
          at,
        });
        break;
      case 'record.deleted':
        records.delete(e.recordId);
        break;
      case 'rule.proposed':
        rules.set(e.ruleId, {
          ruleId: e.ruleId,
          text: e.text,
          appliesWhen: e.appliesWhen,
          expiresWhen: e.expiresWhen,
          tags: e.tags ?? [],
          status: 'proposed',
          proposedAt: at,
          acceptedAt: null,
          pitfallsAfter: 0,
          changesSince: 0,
          suggestRetire: false,
        });
        break;
      case 'rule.accepted': {
        const r = rules.get(e.ruleId);
        const base = r ?? { ruleId: e.ruleId, tags: e.tags ?? [], proposedAt: at, pitfallsAfter: 0, changesSince: 0, suggestRetire: false };
        rules.set(e.ruleId, { ...base, text: e.text, appliesWhen: e.appliesWhen, expiresWhen: e.expiresWhen, status: 'accepted', acceptedAt: at });
        break;
      }
      case 'rule.retired': {
        const r = rules.get(e.ruleId);
        if (r) r.status = 'retired';
        break;
      }
      case 'change.merged':
        merges.push(at);
        break;
      default:
        break;
    }
  }
  const list = [...records.values()];
  for (const r of rules.values()) {
    if (!r.acceptedAt) continue;
    const since = r.acceptedAt;
    r.pitfallsAfter = list.filter((x) => x.kind === 'pitfall' && x.at > since && x.tags.some((t) => r.tags.includes(t))).length;
    r.changesSince = merges.filter((m) => m > since).length;
    r.suggestRetire = r.status === 'accepted' && r.changesSince >= RETIRE_AFTER_CHANGES && r.pitfallsAfter > 0;
  }
  const covered = new Set([...rules.values()].filter((r) => r.status !== 'retired').flatMap((r) => r.tags));
  const counts = new Map<string, number>();
  for (const r of list) if (r.kind === 'pitfall' && r.tags[0] !== '授权') for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tagsNeedingRule = [...counts.entries()].filter(([t, n]) => n >= PITFALLS_PER_RULE && !covered.has(t)).map(([t]) => t);
  return { records: list.sort((a, b) => (a.at < b.at ? 1 : -1)), rules: [...rules.values()], tagsNeedingRule };
}

/** 由已接受的规则生成区块正文（含首尾哨兵）。 */
export function renderRulesBlock(rules: readonly RuleView[]): string {
  const accepted = rules.filter((r) => r.status === 'accepted');
  const body = accepted.length
    ? accepted.map((r) => `- ${r.text}（适用：${r.appliesWhen || '—'}；失效：${r.expiresWhen || '—'}）`).join('\n')
    : '（暂无规则）';
  return `${RULES_BLOCK_START}\n## Stagent 项目规则（由 Stagent 账本生成，请在 Stagent 里修改）\n\n${body}\n${RULES_BLOCK_END}`;
}

export function extractRulesBlock(text: string): string | null {
  const start = text.indexOf(RULES_BLOCK_START);
  const end = text.indexOf(RULES_BLOCK_END, start + 1);
  if (start === -1 || end === -1) return null;
  return text.slice(start, end + RULES_BLOCK_END.length);
}

export function replaceRulesBlock(text: string, block: string): string {
  const current = extractRulesBlock(text);
  if (current !== null) return text.replace(current, block);
  const sep = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${sep}${block}\n`;
}

/** 写入（或更新）两个文件的规则区块，区块外的内容保持不变。 */
export async function writeRulesBlocks(root: string, rules: readonly RuleView[]): Promise<void> {
  const block = renderRulesBlock(rules);
  for (const rel of RULE_FILES) {
    const path = join(root, rel);
    const text = await readFile(path, 'utf8').catch(() => '');
    const next = replaceRulesBlock(text, block);
    if (next !== text) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, next);
    }
  }
}

export interface RulesDrift {
  file: string;
  /** missing：账本有规则但文件里没有区块；modified：区块被手动改过。 */
  problem: 'missing' | 'modified';
  fingerprint: string;
}

/** 校验规则区块是否与账本一致（§10「规则区块完整性」）。账本里一条规则都没接受过时不校验。 */
export async function rulesDrift(root: string, rules: readonly RuleView[]): Promise<RulesDrift[]> {
  if (!rules.some((r) => r.acceptedAt)) return [];
  const expected = renderRulesBlock(rules);
  const out: RulesDrift[] = [];
  for (const rel of RULE_FILES) {
    const text = await readFile(join(root, rel), 'utf8').catch(() => '');
    const block = extractRulesBlock(text);
    if (block === null) out.push({ file: rel.split('\\').join('/'), problem: 'missing', fingerprint: sha256Hex(text) });
    else if (block !== expected) out.push({ file: rel.split('\\').join('/'), problem: 'modified', fingerprint: sha256Hex(block) });
  }
  return out;
}
