/** 剥外层 Markdown 围栏（可重复一次，处理模型多包一层的情况）。仅当整段被单层围栏包裹时才剥离，避免误伤多围栏混排。 */
export function stripOuterMarkdownFences(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 2; i += 1) {
    const m = /^```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(t);
    if (!m) {
      break;
    }
    t = m[1].trim();
  }
  return t;
}

/** 从单个 fenced code block 字符串剥开闭围栏标记（供质量评分等域内逻辑）。 */
export function stripFenceMarkersFromBlock(block: string): string {
  return block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
}

/** 迭代 Markdown fenced code block 内容（不含围栏行）。 */
export function iterMarkdownFencedBlocks(text: string): string[] {
  return Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)).map((m) => m[1].trim());
}

/** 提取第一个 fenced code block 的代码体。 */
export function extractFirstFencedCodeBlock(s: string): string | null {
  const re = /```[\w-]*\r?\n([\s\S]*?)\r?\n```/;
  const m = re.exec(s);
  return m ? m[1] : null;
}

/** 按目标路径优先匹配围栏语言标签（Dockerfile / yaml / ts 等），否则回退首个围栏。 */
export function fenceLangHintsForPath(relPath: string): string[] {
  const normalized = relPath.replace(/\\/g, '/');
  const base = normalized.split('/').pop()?.toLowerCase() ?? '';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';

  if (base === 'dockerfile' || base.endsWith('.dockerfile')) {
    return ['dockerfile', 'docker'];
  }
  if (ext === '.yml' || ext === '.yaml') {
    return ['yaml', 'yml'];
  }
  if (ext === '.json') {
    return ['json'];
  }
  if (ext === '.ts' || ext === '.tsx') {
    return ['typescript', 'ts', 'tsx'];
  }
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    return ['javascript', 'js', 'jsx', 'typescript'];
  }
  if (ext === '.py') {
    return ['python', 'py'];
  }
  if (ext === '.dart') {
    return ['dart'];
  }
  if (ext === '.sh') {
    return ['bash', 'sh', 'shell'];
  }
  return [];
}

export function extractFencedCodeBlockForPath(relPath: string, s: string): string | null {
  for (const hint of fenceLangHintsForPath(relPath)) {
    const re = new RegExp(`\`\`\`${hint}\\s*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, 'i');
    const m = re.exec(s);
    if (m) {
      return m[1];
    }
  }
  return extractFirstFencedCodeBlock(s);
}

/** 在孤立闭围栏行处截断（外层 fence 已剥掉、仅剩 ``` 说明行时）。 */
export function truncateAtOrphanFenceLine(s: string): string {
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (/^```[\w-]*\s*$/.test(lines[i])) {
      return lines.slice(0, i).join('\n').replace(/\s+$/, '');
    }
  }
  return s;
}
