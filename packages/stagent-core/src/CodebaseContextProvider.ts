import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type ProjectType = 'node' | 'react' | 'uniapp' | 'python' | 'unknown';
export type CodebaseSnapshotLevel = 'full' | 'summary' | 'filenames-only' | 'omit';

export interface ModuleSummary {
  path: string;
  exports: string[];
  linesOfCode: number;
  hasTests: boolean;
}

export interface CodebaseSnapshot {
  projectType: ProjectType;
  packageJson?: Record<string, unknown>;
  tsconfig?: Record<string, unknown>;
  entryFiles: string[];
  existingModules: ModuleSummary[];
  gitChangeSummary?: string;
  level: CodebaseSnapshotLevel;
  workspaceRoot: string;
}

const DEFAULT_MAX_MODULES = 80;
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'coverage',
  '.stagent',
  'build',
  '.next',
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.vue']);

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function safeReadJson(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function mergeDeps(packageJson: Record<string, unknown>): Record<string, unknown> {
  return {
    ...((packageJson.dependencies as Record<string, unknown>) ?? {}),
    ...((packageJson.devDependencies as Record<string, unknown>) ?? {}),
  };
}

export function detectProjectType(packageJson?: Record<string, unknown>): ProjectType {
  if (!packageJson) {
    return 'unknown';
  }
  const deps = mergeDeps(packageJson);
  if (deps['@dcloudio/uni-app'] || deps['@dcloudio/vite-plugin-uni']) {
    return 'uniapp';
  }
  if (deps.react || deps['react-dom'] || deps.next) {
    return 'react';
  }
  if (Object.keys(deps).some((k) => k.startsWith('django') || k === 'flask' || k === 'fastapi')) {
    return 'python';
  }
  if (packageJson.name || deps.typescript || deps.express || deps.vite) {
    return 'node';
  }
  return 'unknown';
}

function listSourceFiles(scanRoot: string, maxFiles: number): string[] {
  const out: string[] = [];
  function walk(dir: string, depth: number): void {
    if (out.length >= maxFiles || depth > 8) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) {
        break;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) {
          continue;
        }
        walk(full, depth + 1);
      } else if (ent.isFile() && SOURCE_EXTENSIONS.has(path.extname(ent.name))) {
        out.push(path.relative(scanRoot, full));
      }
    }
  }
  walk(scanRoot, 0);
  return out.sort();
}

function extractExports(content: string): string[] {
  const names: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:async\s+)?class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      names.push(m[1]);
    }
  }
  return [...new Set(names)].slice(0, 20);
}

function readGitChangeSummary(workspaceRoot: string): string | undefined {
  try {
    const out = execSync('git diff --stat HEAD', {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? out.slice(0, 800) : undefined;
  } catch {
    return undefined;
  }
}

/** 同步构建工作区快照（无 LLM）；大仓库由 `applySnapshotDegradation` 渐进降级。 */
export function buildCodebaseSnapshot(
  workspaceRoot: string,
  options?: { maxModules?: number; onDegraded?: (reason: string, context?: Record<string, unknown>) => void },
): CodebaseSnapshot {
  const abs = path.resolve(workspaceRoot);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return {
      projectType: 'unknown',
      entryFiles: [],
      existingModules: [],
      level: 'omit',
      workspaceRoot: abs,
    };
  }

  const packageJson = safeReadJson(path.join(abs, 'package.json'));
  const tsconfig = safeReadJson(path.join(abs, 'tsconfig.json'));
  const projectType = detectProjectType(packageJson);

  const entryCandidates = [
    'src/index.ts',
    'src/main.ts',
    'src/main.tsx',
    'src/index.tsx',
    'index.ts',
    'main.py',
  ];
  const entryFiles = entryCandidates.filter((f) => fs.existsSync(path.join(abs, f)));

  const hasSrc = fs.existsSync(path.join(abs, 'src')) && fs.statSync(path.join(abs, 'src')).isDirectory();
  const scanRoot = hasSrc ? path.join(abs, 'src') : abs;
  const relPrefix = hasSrc ? 'src/' : '';
  const files = listSourceFiles(scanRoot, options?.maxModules ?? DEFAULT_MAX_MODULES);
  const existingModules: ModuleSummary[] = files.map((rel) => {
    const full = path.join(scanRoot, rel);
    let content: string;
    try {
      content = fs.readFileSync(full, 'utf-8');
    } catch {
      content = '';
    }
    const base = path.basename(rel);
    return {
      path: `${relPrefix}${rel}`.replace(/\\/g, '/'),
      exports: extractExports(content),
      linesOfCode: content ? content.split('\n').length : 0,
      hasTests: /(?:^|[/\\])(?:.*\.)?(?:test|spec)\./i.test(base) || /(?:^|[/\\]).*(?:test|spec)[/\\]/i.test(rel),
    };
  });

  return {
    projectType,
    packageJson,
    tsconfig,
    entryFiles,
    existingModules,
    gitChangeSummary: readGitChangeSummary(abs),
    level: 'full',
    workspaceRoot: abs,
  };
}

export function formatSnapshotForPrompt(
  snapshot: CodebaseSnapshot,
  level: CodebaseSnapshotLevel = snapshot.level,
): string {
  if (level === 'omit') {
    return '';
  }

  const lines: string[] = [`项目类型: ${snapshot.projectType}`];

  if (level === 'filenames-only') {
    lines.push('源文件列表（仅路径）:');
    for (const mod of snapshot.existingModules.slice(0, 80)) {
      lines.push(`- ${mod.path}`);
    }
    return lines.join('\n');
  }

  if (snapshot.packageJson) {
    const name = snapshot.packageJson.name ?? '?';
    const scripts = snapshot.packageJson.scripts ?? {};
    lines.push(`package.json: name=${String(name)}, scripts=${JSON.stringify(scripts)}`);
  }
  if (snapshot.tsconfig && level === 'full') {
    const compilerOptions = snapshot.tsconfig.compilerOptions ?? {};
    lines.push(`tsconfig: compilerOptions=${JSON.stringify(compilerOptions)}`);
  }
  if (snapshot.entryFiles.length > 0) {
    lines.push(`入口文件: ${snapshot.entryFiles.join(', ')}`);
  }

  lines.push(`模块概览（${snapshot.existingModules.length} 个源文件）:`);
  const cap = level === 'summary' ? 40 : 80;
  for (const mod of snapshot.existingModules.slice(0, cap)) {
    const exportHint =
      mod.exports.length > 0 && level === 'full'
        ? `, exports: ${mod.exports.slice(0, 6).join(', ')}`
        : '';
    lines.push(`- ${mod.path} (${mod.linesOfCode} LOC${exportHint})`);
  }
  if (snapshot.existingModules.length > cap) {
    lines.push(`… 另有 ${snapshot.existingModules.length - cap} 个文件未列出`);
  }

  if (snapshot.gitChangeSummary && level === 'full') {
    lines.push('\nGit 变更摘要 (git diff --stat HEAD):');
    lines.push(snapshot.gitChangeSummary);
  }

  return lines.join('\n');
}

/** 渐进降级 full → summary → filenames-only → omit，直至不超过 maxTokens。 */
export function applySnapshotDegradation(
  snapshot: CodebaseSnapshot,
  maxTokens: number,
): { text: string; level: CodebaseSnapshotLevel } {
  const order: CodebaseSnapshotLevel[] = ['full', 'summary', 'filenames-only', 'omit'];
  for (const level of order) {
    const text = formatSnapshotForPrompt(snapshot, level);
    if (!text.trim()) {
      continue;
    }
    if (estimateTextTokens(text) <= maxTokens) {
      return { text, level };
    }
  }
  return { text: '', level: 'omit' };
}
