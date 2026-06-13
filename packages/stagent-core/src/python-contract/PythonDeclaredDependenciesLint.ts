import * as fs from 'fs';
import * as path from 'path';
import { parsePythonFromImports } from './PythonExportContractLint';
import { isDeclaredImportRoot } from '../commitment/decisionArtifactsSchema';
import { isPythonStdlibRoot } from './pythonStdlibRoots';

const IMPORT_RE = /^\s*import\s+([a-zA-Z_][\w.]*(?:\s*,\s*[a-zA-Z_][\w.]*)*)/gm;

export type DeclaredDependencyIssueCode = 'python-undeclared-dependency';

export interface DeclaredDependencyIssue {
  code: DeclaredDependencyIssueCode;
  message: string;
  package: string;
  file: string;
}

export function parsePythonImportRoots(content: string): string[] {
  const roots = new Set<string>();
  for (const imp of parsePythonFromImports(content)) {
    roots.add(imp.module.split('.')[0]!.toLowerCase());
  }
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const parts = m[1]!
      .split(',')
      .map((p) => p.trim().split(/\s+as\s+/i)[0]!.trim())
      .filter(Boolean);
    for (const part of parts) {
      roots.add(part.split('.')[0]!.toLowerCase());
    }
  }
  return [...roots];
}

export function lintDeclaredDependenciesInFiles(params: {
  workspaceRoot: string;
  pyFiles: string[];
  allowedDeps: string[];
  projectModuleNames: string[];
}): DeclaredDependencyIssue[] {
  const { workspaceRoot, pyFiles, allowedDeps, projectModuleNames } = params;
  const project = new Set(projectModuleNames.map((n) => n.toLowerCase()));
  const issues: DeclaredDependencyIssue[] = [];
  const seen = new Set<string>();

  for (const rel of pyFiles) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const relNorm = rel.replace(/\\/g, '/');
    for (const root of parsePythonImportRoots(content)) {
      if (isPythonStdlibRoot(root) || project.has(root) || isDeclaredImportRoot(root, allowedDeps)) {
        continue;
      }
      const key = `${relNorm}:${root}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      issues.push({
        code: 'python-undeclared-dependency',
        message: `python-declared-deps：${relNorm} import ${root}，但 decisionArtifacts.dependencies 未声明该包`,
        package: root,
        file: relNorm,
      });
    }
  }
  return issues;
}
