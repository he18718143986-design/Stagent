import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_WORKSPACE_SKIP_DIR_NAMES } from './WorkspaceSkipDirs';

const DEFAULT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export type ListSourceFilesOptions = {
  maxFiles?: number;
  maxDepth?: number;
  extensions?: Set<string>;
  skipDirNames?: ReadonlySet<string>;
};

/** 递归列举源码文件（绝对路径），供代码库快照与依赖图共用。 */
export function listSourceFiles(root: string, options?: ListSourceFilesOptions): string[] {
  const maxFiles = options?.maxFiles ?? 200;
  const maxDepth = options?.maxDepth ?? 10;
  const extensions = options?.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
  const skipDirs = options?.skipDirNames ?? DEFAULT_WORKSPACE_SKIP_DIR_NAMES;
  const out: string[] = [];

  function walk(dir: string, depth: number): void {
    if (out.length >= maxFiles || depth > maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) {
        break;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) {
          walk(full, depth + 1);
        }
      } else if (ent.isFile() && extensions.has(path.extname(ent.name))) {
        out.push(full);
      }
    }
  }

  walk(root, 0);
  return out.sort();
}
