import * as fs from 'fs';
import * as path from 'path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/** 将相对 import spec 解析为磁盘上已存在的文件绝对路径（含扩展名 / index 候选）。 */
export function resolveExistingImportPath(fromDir: string, spec: string): string | undefined {
  const base = path.resolve(fromDir, spec);
  for (const ext of ['', ...SOURCE_EXTENSIONS]) {
    const candidate = ext ? `${base}${ext}` : base;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // skip unreadable candidate
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const idx = path.join(base, `index${ext}`);
    if (fs.existsSync(idx)) {
      return idx;
    }
  }
  return undefined;
}
