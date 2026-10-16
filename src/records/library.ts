/**
 * 个人通用库（规格 §10、D8）：勾选「同步到个人通用库」的记录或规则复制到 ~/.stagent/library/*.md；
 * 新项目接入时按技术栈标签列出匹配的规则供挑选。
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { libraryDir } from '../home/home.js';

export interface LibraryItem {
  id: string;
  kind: 'rule' | 'decision' | 'pitfall';
  title: string;
  body: string;
  tags: string[];
  /** 技术栈标签（来自 init 检测结果，如 next、vitest）。 */
  stack: string[];
  appliesWhen?: string;
  expiresWhen?: string;
  savedAt: string;
}

export async function saveToLibrary(item: Omit<LibraryItem, 'savedAt'>): Promise<string> {
  await mkdir(libraryDir(), { recursive: true });
  const full: LibraryItem = { ...item, savedAt: new Date().toISOString() };
  const path = join(libraryDir(), `${item.id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
  const front = JSON.stringify({ ...full, body: undefined });
  await writeFile(path, `---\n${front}\n---\n\n# ${full.title}\n\n${full.body}\n`);
  return path;
}

export async function listLibrary(stack?: readonly string[]): Promise<LibraryItem[]> {
  let names: string[];
  try {
    names = await readdir(libraryDir());
  } catch {
    return [];
  }
  const out: LibraryItem[] = [];
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    const text = await readFile(join(libraryDir(), name), 'utf8').catch(() => '');
    const m = /^---\n(.*)\n---\n\n# .*\n\n([\s\S]*)$/.exec(text);
    if (!m) continue;
    try {
      const meta = JSON.parse(m[1]!) as Omit<LibraryItem, 'body'>;
      out.push({ ...meta, body: m[2]!.trimEnd() });
    } catch {
      // 手改坏的条目忽略
    }
  }
  if (!stack || stack.length === 0) return out;
  return out.filter((x) => x.stack.length === 0 || x.stack.some((s) => stack.includes(s)));
}
