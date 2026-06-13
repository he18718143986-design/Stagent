const FILE_DELIMITER_RE = /^---\s*file:\s*(.+?)\s*---\s*$/im;

export interface ParsedMultiFileOutput {
  files: Map<string, string>;
  /** 无分隔符时视为单文件正文。 */
  singleFileBody?: string;
}

export function parseDelimitedMultiFileOutput(text: string): ParsedMultiFileOutput {
  const trimmed = text.trim();
  if (!FILE_DELIMITER_RE.test(trimmed)) {
    return { files: new Map(), singleFileBody: trimmed };
  }

  const files = new Map<string, string>();
  const parts = trimmed.split(FILE_DELIMITER_RE);
  // parts[0] is preamble (often empty); then path, content, path, content...
  for (let i = 1; i < parts.length; i += 2) {
    const relPath = parts[i]?.trim();
    const content = (parts[i + 1] ?? '').replace(/^\n/, '').replace(/\n$/, '').trimEnd();
    if (relPath) {
      files.set(relPath.replace(/\\/g, '/'), content);
    }
  }
  return { files };
}

export function resolvePrimaryWriteContent(
  primaryPath: string,
  text: string,
  additionalTargets: string[] | undefined,
): { primaryContent: string; additionalFiles: Map<string, string> } {
  const additional = additionalTargets?.filter(Boolean) ?? [];
  if (additional.length === 0) {
    return { primaryContent: text, additionalFiles: new Map() };
  }
  const parsed = parseDelimitedMultiFileOutput(text);
  if (parsed.singleFileBody !== undefined) {
    return { primaryContent: parsed.singleFileBody, additionalFiles: new Map() };
  }
  const normPrimary = primaryPath.replace(/\\/g, '/');
  const primaryContent = parsed.files.get(normPrimary);
  if (primaryContent === undefined) {
    return { primaryContent: text, additionalFiles: new Map() };
  }
  const additionalFiles = new Map<string, string>();
  for (const target of additional) {
    const norm = target.replace(/\\/g, '/');
    const content = parsed.files.get(norm);
    if (content !== undefined) {
      additionalFiles.set(norm, content);
    }
  }
  return { primaryContent, additionalFiles };
}
