/**
 * AI 回报的固定格式与解析（§8）。回报只是"声称"，解析结果只会写成 claim.reported。
 *
 * 要求 AI 在最后按下面的格式回报：
 *
 *   ## 改了什么
 *   …
 *   ## 取舍
 *   …
 *   ## 例子
 *   - e-1234: 已实现
 *
 * 缺少「改了什么」段时视为格式异常（malformed），原文照样入库，UI 标「回报格式异常」。
 */
import type { ClaimReport } from './types.js';

export const REPORT_FORMAT = `最后请严格按以下格式回报（标题必须一字不差）：

## 改了什么
（用大白话说明改了哪些文件、为什么）

## 取舍
（做了哪些取舍；没有就写"无"）

## 例子
（每个你认为已实现的例子一行，格式 "- <exampleId>: 已实现"；没有就写"无"）`;

export function parseClaimReport(text: string, knownExampleIds: readonly string[] = []): ClaimReport {
  const sections = splitSections(text);
  const changed = sections.get('改了什么')?.trim() ?? '';
  const tradeoffs = sections.get('取舍')?.trim() ?? '';
  const examplesText = sections.get('例子') ?? '';
  const known = new Set(knownExampleIds);
  const claimedExampleIds: string[] = [];
  for (const line of examplesText.split('\n')) {
    const m = /^\s*[-*]\s*([A-Za-z0-9_-]+)\s*[:：]\s*(.+)$/.exec(line);
    if (!m) continue;
    const id = m[1]!;
    if (/未|没有|not/i.test(m[2]!)) continue;
    if (known.size === 0 || known.has(id)) claimedExampleIds.push(id);
  }
  return { text: text.trim(), changed, tradeoffs, claimedExampleIds, malformed: changed === '' };
}

function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) out.set(current, buf.join('\n'));
  };
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,4}\s*(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = h[1]!.trim();
      buf = [];
    } else if (current !== null) buf.push(line);
  }
  flush();
  return out;
}

/** 从 AI 的文本里取最后一个 ```json 代码块（或整段 JSON）。取不到返回 undefined。 */
export function extractJson(text: string): unknown {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  for (const candidate of [...blocks.reverse(), text]) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // 继续尝试
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
