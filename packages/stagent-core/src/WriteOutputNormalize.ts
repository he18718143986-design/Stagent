import * as path from 'path';
import { extractJsonObject } from './JsonExtract';
import { applyDcloudVue3VitePinsIfUniAppScaffold } from './uniappPackagePins';

/** 首行形如 `src/foo.ts` / `README.md`（模型常加的“文件名标题”），与真实路径 basename 一致或可接受时剥掉 */
function stripLeadingFilenameEchoLine(s: string, relPath: string): string {
  const base = path.basename(relPath);
  const first = s.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!first) {
    return s;
  }
  // 完全匹配 basename，或仅路径分隔差异（模型写 src/x.ts 而 relPath 为 x.ts）
  if (first === base || first.endsWith(`/${base}`) || first.endsWith(`\\${base}`)) {
    return s.replace(/^[^\r\n]+\r?\n(?:\r?\n)*/, '');
  }
  return s;
}

/** 剥外层 Markdown 围栏（可重复一次，处理模型多包一层的情况） */
function stripOuterMarkdownFences(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 2; i += 1) {
    const next = t.replace(/^```[\w-]*\r?\n/, '').replace(/\r?\n```\s*$/, '').trim();
    if (next === t) {
      break;
    }
    t = next;
  }
  return t;
}

/** 提取**第一个** fenced code block 的代码体（处理「中文说明 + ```lang + 代码 + ``` + 表格说明」混排）。 */
function extractFirstFencedCodeBlock(s: string): string | null {
  const re = /```[\w-]*\r?\n([\s\S]*?)\r?\n```/;
  const m = re.exec(s);
  return m ? m[1] : null;
}

/**
 * 若全文出现一行恰好为 ``` 或 ```lang 的「孤立围栏行」（开围栏已被外层剥掉、仅剩闭围栏），
 * 则把它及之后的所有内容截断（视为模型续写的 Markdown 说明：表格 / 注释说明 / 标题等）。
 * 仅在 extractFirstFencedCodeBlock 已失败（即没有完整 fenced pair）时调用。
 */
function truncateAtOrphanFence(s: string): string {
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (/^```[\w-]*\s*$/.test(lines[i])) {
      return lines.slice(0, i).join('\n').replace(/\s+$/, '');
    }
  }
  return s;
}

/**
 * 将 llm-text 输出整理为可写入磁盘的内容。
 * 对 `package.json` 等 JSON 目标：必须从输出中提取合法 JSON（避免模型把 Markdown 决策清单写进 package.json 导致 npm EJSONPARSE）。
 */
export function normalizeLlmOutputForWritePath(
  relPath: string,
  raw: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  let stripped = raw.trim();
  stripped = stripLeadingFilenameEchoLine(stripped, relPath);
  stripped = stripOuterMarkdownFences(stripped);

  const base = path.basename(relPath).toLowerCase();
  const tsconfigLenient =
    base === 'tsconfig.json' || base === 'tsconfig.app.json' || base === 'tsconfig.node.json';

  if (tsconfigLenient) {
    const candidate = extractJsonObject(stripped) ?? stripped;
    try {
      const o = JSON.parse(candidate);
      return { ok: true, content: JSON.stringify(o, null, 2) + '\n' };
    } catch {
      return { ok: true, content: stripped };
    }
  }

  const looksJson =
    base === 'package.json' ||
    base === 'package-lock.json' ||
    relPath.toLowerCase().endsWith('.json');

  if (!looksJson) {
    // 非 markdown 代码文件：清理「中文说明 + ```lang + 代码 + ``` + 表格」或「代码 + 孤立 ``` + 表格」两种混排。
    const ext = path.extname(relPath).toLowerCase();
    const isMarkdown = ext === '.md' || ext === '.markdown';
    if (!isMarkdown) {
      const inner = extractFirstFencedCodeBlock(stripped);
      if (inner !== null) {
        return { ok: true, content: inner };
      }
      const truncated = truncateAtOrphanFence(stripped);
      if (truncated !== stripped) {
        return { ok: true, content: truncated };
      }
    }
    return { ok: true, content: stripped };
  }

  const candidate = (extractJsonObject(stripped) ?? stripped).trim();
  try {
    const o = JSON.parse(candidate);
    if (base === 'package.json' && (typeof o !== 'object' || o === null || Array.isArray(o))) {
      return { ok: false, reason: 'package.json 根必须为 JSON 对象' };
    }
    if (base === 'package.json' && typeof o === 'object' && o !== null && !Array.isArray(o)) {
      applyDcloudVue3VitePinsIfUniAppScaffold(o as Record<string, unknown>);
    }
    return { ok: true, content: JSON.stringify(o, null, 2) + '\n' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: `目标为 JSON 文件但无法解析合法内容（模型可能输出了 Markdown/说明文字而非 JSON）：${msg}`,
    };
  }
}
