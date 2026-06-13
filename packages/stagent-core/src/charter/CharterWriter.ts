import * as fs from 'fs';
import * as path from 'path';
import type { CharterRuleType } from './CharterTypes';
import { parseCharterMarkdown } from './CharterParser';
import type { CharterFeedbackWriteEntry, CharterWriteResult } from './CharterFeedbackTypes';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const VERSION_RE = /^charterVersion:\s*(\d+)\s*$/m;
const UPDATED_RE = /^charterUpdatedAt:\s*(.+)\s*$/m;

const SECTION_HEADERS: Record<CharterRuleType, string> = {
  prefer: '## 优先（Prefer）',
  avoid: '## 避免（Avoid）',
  acceptable: '## 可接受（Acceptable）',
  constraint: '## 约束（Constraints）',
  escalate: '## 升级（Escalate）',
};

const SECTION_FALLBACK_PATTERNS: Record<CharterRuleType, RegExp> = {
  prefer: /^##\s*(优先|prefer)/i,
  avoid: /^##\s*(避免|avoid)/i,
  acceptable: /^##\s*(可接受|acceptable)/i,
  constraint: /^##\s*(约束|constraints?)/i,
  escalate: /^##\s*(升级|escalat)/i,
};

const DEFAULT_CHARTER_SCAFFOLD = `---
charterVersion: 0
---

# 决策主旨（Charter）

## 优先（Prefer）

## 避免（Avoid）

## 可接受（Acceptable）

## 约束（Constraints）

## 升级（Escalate）

`;

export interface ParsedCharterFrontmatter {
  version: number;
  updatedAt?: string;
  body: string;
  hasFrontmatter: boolean;
}

export function parseCharterFrontmatter(raw: string): ParsedCharterFrontmatter {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { version: 0, body: raw, hasFrontmatter: false };
  }
  const block = match[1]!;
  const versionMatch = VERSION_RE.exec(block);
  const updatedMatch = UPDATED_RE.exec(block);
  return {
    version: versionMatch ? Number.parseInt(versionMatch[1]!, 10) : 0,
    updatedAt: updatedMatch?.[1]?.trim(),
    body: raw.slice(match[0].length),
    hasFrontmatter: true,
  };
}

function buildFrontmatter(version: number, updatedAt: string): string {
  return `---\ncharterVersion: ${version}\ncharterUpdatedAt: ${updatedAt}\n---\n\n`;
}

function findSectionInsertIndex(lines: string[], type: CharterRuleType): number {
  const header = SECTION_HEADERS[type];
  const pattern = SECTION_FALLBACK_PATTERNS[type];
  let headerIdx = lines.findIndex((line) => line.trim() === header || pattern.test(line.trim()));
  if (headerIdx < 0) {
    return -1;
  }
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) {
      insertAt = i + 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      break;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      insertAt = i + 1;
    }
  }
  return insertAt;
}

function appendRuleLines(raw: string, entries: CharterFeedbackWriteEntry[]): string {
  const lines = raw.split(/\r?\n/);
  for (const entry of entries) {
    const bullet = `- ${entry.text.trim()}`;
    const idx = findSectionInsertIndex(lines, entry.type);
    if (idx < 0) {
      lines.push('', SECTION_HEADERS[entry.type], bullet);
      continue;
    }
    lines.splice(idx, 0, bullet);
  }
  return lines.join('\n');
}

function ensureFrontmatter(raw: string, nextVersion: number, updatedAt: string): string {
  const parsed = parseCharterFrontmatter(raw);
  if (parsed.hasFrontmatter) {
    const block = FRONTMATTER_RE.exec(raw)![1]!;
    let nextBlock = block.replace(VERSION_RE, `charterVersion: ${nextVersion}`);
    if (UPDATED_RE.test(nextBlock)) {
      nextBlock = nextBlock.replace(UPDATED_RE, `charterUpdatedAt: ${updatedAt}`);
    } else {
      nextBlock = `${nextBlock.trim()}\ncharterUpdatedAt: ${updatedAt}`;
    }
    return raw.replace(FRONTMATTER_RE, `---\n${nextBlock}\n---\n\n`);
  }
  return `${buildFrontmatter(nextVersion, updatedAt)}${raw.trimStart()}`;
}

/** 将候选规则追加到 Charter markdown 并 bump charterVersion。 */
export function appendCharterFeedbackEntries(
  absolutePath: string,
  entries: CharterFeedbackWriteEntry[],
  nowIso = new Date().toISOString(),
): CharterWriteResult {
  if (entries.length === 0) {
    throw new Error('appendCharterFeedbackEntries: no entries');
  }
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existingRaw = fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, 'utf8')
    : DEFAULT_CHARTER_SCAFFOLD;
  const parsed = parseCharterFrontmatter(existingRaw);
  const nextVersion = (Number.isFinite(parsed.version) ? parsed.version : 0) + 1;
  const withRules = appendRuleLines(existingRaw, entries);
  const finalRaw = ensureFrontmatter(withRules, nextVersion, nowIso);
  fs.writeFileSync(absolutePath, finalRaw, 'utf8');
  parseCharterMarkdown(absolutePath, finalRaw);
  return {
    absolutePath,
    previousVersion: parsed.version,
    nextVersion,
    appendedCount: entries.length,
  };
}
