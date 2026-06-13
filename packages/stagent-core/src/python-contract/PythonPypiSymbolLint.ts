import * as fs from 'fs';
import * as path from 'path';
import { lintPypiForbiddenImports, type PypiSymbolLintIssue } from '../PypiSymbolHints';

export type PythonPypiSymbolIssueCode = 'python-pypi-forbidden-symbol';

export interface PythonPypiSymbolIssue extends PypiSymbolLintIssue {
  code: PythonPypiSymbolIssueCode;
  file: string;
}

export function lintPythonPypiSymbolsInContent(relPath: string, content: string): PythonPypiSymbolIssue[] {
  return lintPypiForbiddenImports(content).map((issue) => ({
    ...issue,
    code: 'python-pypi-forbidden-symbol' as const,
    file: relPath.replace(/\\/g, '/'),
  }));
}

export function lintPythonPypiSymbolsOnDisk(params: {
  workspaceRoot: string;
  pyFiles: string[];
}): PythonPypiSymbolIssue[] {
  const { workspaceRoot, pyFiles } = params;
  const issues: PythonPypiSymbolIssue[] = [];
  const seen = new Set<string>();
  for (const rel of pyFiles) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    for (const issue of lintPythonPypiSymbolsInContent(rel.replace(/\\/g, '/'), content)) {
      const key = `${issue.file}:${issue.package}:${issue.symbol}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      issues.push(issue);
    }
  }
  return issues;
}
