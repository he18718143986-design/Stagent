import type { Stage } from '../../WorkflowDefinition';

export const FILE_OUTPUT_KEY_PREFIX = 'file_';

export function pathFromFileOutputKey(key: string): string {
  if (!key.startsWith(FILE_OUTPUT_KEY_PREFIX)) {
    return key;
  }
  return key.slice(FILE_OUTPUT_KEY_PREFIX.length);
}

export function headerLabelsForOutputKey(key: string): string[] {
  const path = pathFromFileOutputKey(key);
  return path === key ? [key] : [key, path];
}

/** 阶段声明 ≥2 个 file_* 输出键时视为多文件 bundle impl。 */
export function isMultiFileBundleStage(stage: Stage): boolean {
  const fileKeys = (stage.outputs ?? [])
    .map((o) => o.key)
    .filter((k) => k.startsWith(FILE_OUTPUT_KEY_PREFIX));
  return fileKeys.length >= 2;
}

export function fileOutputKeysForStage(stage: Stage): string[] {
  return (stage.outputs ?? [])
    .map((o) => o.key)
    .filter((k) => k.startsWith(FILE_OUTPUT_KEY_PREFIX));
}

export function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  const closed = /^```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/m.exec(trimmed);
  if (closed) {
    return closed[1].trimEnd();
  }
  const openOnly = /^```[\w-]*\r?\n([\s\S]*)$/m.exec(trimmed);
  if (openOnly && !trimmed.slice(3).includes('```')) {
    return openOnly[1].trimEnd();
  }
  return trimmed;
}

/**
 * 从 LLM 多文件 bundle 正文拆分到各 file_* outputKey。
 * 支持 `file_config.yaml` / `config.yaml` 行首标题 + 可选 markdown 围栏。
 */
export function parseMultiFileBundleOutput(
  text: string,
  expectedKeys: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!text.trim() || expectedKeys.length === 0) {
    return result;
  }

  const positions: Array<{ key: string; start: number; headerEnd: number }> = [];

  for (const key of expectedKeys) {
    let bestStart = -1;
    let headerEnd = -1;
    for (const label of headerLabelsForOutputKey(key)) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|\\n)${escaped}\\s*\\r?\\n`, 'm');
      const m = re.exec(text);
      if (m && (bestStart < 0 || m.index < bestStart)) {
        bestStart = m.index;
        headerEnd = m.index + m[0].length;
      }
    }
    if (bestStart >= 0) {
      positions.push({ key, start: bestStart, headerEnd });
    }
  }

  positions.sort((a, b) => a.start - b.start);

  const seen = new Set<string>();
  for (let i = 0; i < positions.length; i++) {
    const { key, headerEnd } = positions[i]!;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const end = i + 1 < positions.length ? positions[i + 1]!.start : text.length;
    result[key] = stripCodeFences(text.slice(headerEnd, end));
  }

  if (positions.length === 0 && expectedKeys[0]) {
    result[expectedKeys[0]] = stripCodeFences(text);
  }

  return result;
}

/** 将 bundle 解析结果写入 runtime.outputs（未匹配键留空）。 */
export function applyMultiFileBundleOutputs(
  runtimeOutputs: Record<string, unknown>,
  text: string,
  expectedKeys: readonly string[],
): void {
  const parsed = parseMultiFileBundleOutput(text, expectedKeys);
  for (const key of expectedKeys) {
    runtimeOutputs[key] = parsed[key] ?? '';
  }
}
