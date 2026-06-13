import * as fs from 'fs';
import * as path from 'path';

export function resolveFirstExistingReadablePath(opts: {
  relativePath: string;
  searchRoots: string[];
  fallbackAbsolute: string;
}): string {
  const { relativePath, searchRoots, fallbackAbsolute } = opts;
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  for (const root of searchRoots) {
    if (!root) {
      continue;
    }
    const candidate = path.join(root, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return fallbackAbsolute;
}
