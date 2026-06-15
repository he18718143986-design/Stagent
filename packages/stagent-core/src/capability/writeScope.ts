/**
 * 写入范围校验（纯函数，无第三方依赖）。
 *
 * 规则：
 * 1. 先规范化 relPath（去 `./`、统一 `/`、合并多斜杠）；越界 `..` 视为 write-out-of-scope。
 * 2. `deniedWritePaths` 命中 → write-denied（优先于 allowed）。
 * 3. 设了 `allowedWritePaths` 且都不匹配 → write-out-of-scope。
 * 4. 未设 caps 或未设 allowedWritePaths → allowed（向后兼容）。
 *
 * 匹配支持：`src/store/**`（前缀目录）、`src/store/`（前缀）、精确 `config.json`。
 */

import type { CapabilityViolation, StageCapabilities } from './StageCapabilityTypes';

/** 规范化为 posix 相对路径；越界（解析后以 `..` 开头）返回 null。 */
function normalizeRelPath(relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return null;
  }
  // 统一分隔符并合并多余斜杠
  const unified = relPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  const segments = unified.split('/');
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (stack.length === 0) {
        // 越出 workspace 根
        return null;
      }
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  if (stack.length === 0) {
    return null;
  }
  return stack.join('/');
}

/** 规范化模式：去掉前导 `./`、统一分隔符、合并多斜杠、去掉前导 `/`。 */
function normalizePattern(pattern: string): string {
  return pattern
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
}

/**
 * 小而稳的 matcher：
 * - 尾部 `**`（如 `src/store/**`）→ 目录前缀匹配（含目录本身的子路径）。
 * - 尾部 `/`（如 `src/store/`）→ 前缀匹配。
 * - 否则视为精确匹配，或"目录前缀"（pattern 作为目录时其下任意文件）。
 */
function matchesPattern(normPath: string, rawPattern: string): boolean {
  const pattern = normalizePattern(rawPattern);
  if (pattern.length === 0) {
    return false;
  }
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3); // 去掉 `/**`
    if (prefix.length === 0) {
      return true;
    }
    return normPath === prefix || normPath.startsWith(prefix + '/');
  }
  if (pattern.endsWith('**')) {
    const prefix = pattern.slice(0, -2);
    if (prefix.length === 0) {
      return true;
    }
    return normPath.startsWith(prefix);
  }
  if (pattern.endsWith('/')) {
    return normPath.startsWith(pattern);
  }
  // 精确匹配，或将 pattern 当作目录前缀（pattern 下的子路径）
  return normPath === pattern || normPath.startsWith(pattern + '/');
}

export function checkWritePathAllowed(
  caps: StageCapabilities | undefined,
  relPath: string,
): { allowed: boolean; violation?: CapabilityViolation } {
  const norm = normalizeRelPath(relPath);
  if (norm === null) {
    return {
      allowed: false,
      violation: {
        kind: 'write-out-of-scope',
        detail: `路径越界或非法（无法规范化为 workspace 内相对路径）：${JSON.stringify(relPath)}`,
      },
    };
  }

  if (!caps) {
    return { allowed: true };
  }

  const denied = caps.deniedWritePaths ?? [];
  for (const p of denied) {
    if (typeof p === 'string' && matchesPattern(norm, p)) {
      return {
        allowed: false,
        violation: {
          kind: 'write-denied',
          detail: `路径命中 deniedWritePaths 规则 ${JSON.stringify(p)}：${norm}`,
        },
      };
    }
  }

  const allowed = caps.allowedWritePaths;
  if (!allowed || allowed.length === 0) {
    // 未设 allowedWritePaths → 不限制写入路径
    return { allowed: true };
  }

  for (const p of allowed) {
    if (typeof p === 'string' && matchesPattern(norm, p)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    violation: {
      kind: 'write-out-of-scope',
      detail: `路径不在 allowedWritePaths 范围内：${norm}`,
    },
  };
}
