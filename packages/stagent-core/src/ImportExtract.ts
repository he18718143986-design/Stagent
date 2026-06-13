/** 从源码文本提取 import/require/export-from/jest.mock 路径 spec。 */

const ALL_IMPORT_SPEC_PATTERNS = [
  /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /jest\.mock\s*\(\s*['"]([^'"]+)['"]/g,
];

function collectImportSpecs(content: string, patterns: readonly RegExp[]): string[] {
  const specs = new Set<string>();
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      specs.add(m[1]!);
    }
  }
  return [...specs];
}

/** 提取全部 import spec（含 node_modules 等），供依赖图分析。 */
export function extractAllImportSpecs(content: string): string[] {
  return collectImportSpecs(content, ALL_IMPORT_SPEC_PATTERNS);
}

/** 提取相对 import spec（以 `.` 开头），供静态分析与 SDK 路径契约 lint。 */
export function extractRelativeImportSpecs(content: string): string[] {
  return extractAllImportSpecs(content).filter((spec) => spec.startsWith('.'));
}
