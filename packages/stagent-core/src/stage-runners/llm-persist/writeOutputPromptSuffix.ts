import * as path from 'path';

const CODE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.dart',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.php',
  '.cs',
  '.rb',
  '.swift',
  '.vue',
  '.svelte',
]);

/**
 * 运行时追加到 llm-text systemPrompt，降低 Markdown 混排 / 多文件落盘失败率。
 * 与 writeOutputIntegrity、normalizeLlmOutputForWritePath 配合使用。
 */
export function buildWriteOutputPromptSuffix(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const base = path.basename(normalized).toLowerCase();
  const ext = path.extname(normalized).toLowerCase();

  if (base === 'dockerfile' || base.endsWith('.dockerfile')) {
    return [
      '【落盘硬约束】',
      `只输出 ${normalized} 的完整正文（以 FROM 或 # 开头）。`,
      '禁止 Markdown 标题、说明段落、代码围栏。',
      '禁止在同一输出中包含 docker-compose.yml 或其他路径的文件内容。',
    ].join('\n');
  }

  if (ext === '.yml' || ext === '.yaml') {
    return [
      '【落盘硬约束】',
      `只输出 ${normalized} 的完整 YAML 正文。`,
      '禁止 Markdown、代码围栏、多文件混排。',
    ].join('\n');
  }

  if (ext === '.json' || base === 'package.json' || base === 'package-lock.json') {
    return [
      '【落盘硬约束】',
      `只输出 ${normalized} 的合法 JSON 对象；第一个非空白字符必须是 {，最后一个非空白字符必须是 }。`,
      '禁止 Markdown、说明文字、代码围栏。',
    ].join('\n');
  }

  if (CODE_EXTS.has(ext)) {
    return [
      '【落盘硬约束】',
      `只输出 ${normalized} 的完整源码。`,
      '禁止 Markdown 说明、代码围栏、禁止输出其他路径的文件。',
    ].join('\n');
  }

  return [
    '【落盘硬约束】',
    `只输出 writeOutputToFile 目标文件 ${normalized} 的完整正文。`,
    '禁止 Markdown 包装、代码围栏、多文件混排。',
  ].join('\n');
}
