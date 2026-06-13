import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Stage } from './WorkflowDefinition';

export type AnalysisCheck =
  | { type: 'typescript'; tsconfigPath: string }
  | { type: 'eslint'; configPath?: string; targetGlob: string }
  | { type: 'imports'; entryPoint: string }
  | { type: 'custom'; command: string };

export interface AnalysisResult {
  check: AnalysisCheck;
  passed: boolean;
  errors: string[];
  warnings: string[];
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
}

export type RunCommandFn = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const DEFAULT_TIMEOUT_MS = 60_000;

const RELATIVE_IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

function resolveImportTarget(entryDir: string, importPath: string): boolean {
  const base = path.resolve(entryDir, importPath);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

function runImportsCheck(entryPoint: string, workspaceRoot: string): {
  passed: boolean;
  errors: string[];
  warnings: string[];
} {
  const absEntry = path.isAbsolute(entryPoint)
    ? entryPoint
    : path.join(workspaceRoot, entryPoint);
  if (!fs.existsSync(absEntry)) {
    return { passed: false, errors: [`entry missing: ${entryPoint}`], warnings: [] };
  }
  const content = fs.readFileSync(absEntry, 'utf-8');
  const errors: string[] = [];
  for (const match of content.matchAll(RELATIVE_IMPORT_RE)) {
    const rel = match[1];
    if (!rel || !resolveImportTarget(path.dirname(absEntry), rel)) {
      errors.push(`unresolved import "${rel}" in ${entryPoint}`);
    }
  }
  return { passed: errors.length === 0, errors: errors.slice(0, 20), warnings: [] };
}

async function defaultRunCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr.on('data', (buf: Buffer) => {
      stderr += buf.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('static-analysis-timeout'));
        return;
      }
      resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
    });
  });
}

async function runSingleCheck(
  check: AnalysisCheck,
  workspaceRoot: string,
  timeoutMs: number,
  runCommand: RunCommandFn,
): Promise<AnalysisResult> {
  const started = Date.now();
  try {
    if (check.type === 'typescript') {
      const cmd = `npx tsc -p "${check.tsconfigPath}" --noEmit`;
      const result = await runCommand(cmd, workspaceRoot, timeoutMs);
      const combined = `${result.stdout}\n${result.stderr}`.trim();
      const errors = combined
        .split('\n')
        .filter((l) => l.includes('error TS'))
        .slice(0, 20);
      return {
        check,
        passed: result.exitCode === 0,
        errors,
        warnings: [],
        durationMs: Date.now() - started,
      };
    }
    if (check.type === 'eslint') {
      const cfg = check.configPath ? `--config "${check.configPath}"` : '';
      const cmd = `npx eslint ${cfg} "${check.targetGlob}"`;
      const result = await runCommand(cmd, workspaceRoot, timeoutMs);
      return {
        check,
        passed: result.exitCode === 0,
        errors: result.stderr.split('\n').filter(Boolean).slice(0, 20),
        warnings: result.stdout.split('\n').filter(Boolean).slice(0, 10),
        durationMs: Date.now() - started,
      };
    }
    if (check.type === 'imports') {
      const result = runImportsCheck(check.entryPoint, workspaceRoot);
      return {
        check,
        passed: result.passed,
        errors: result.errors,
        warnings: result.warnings,
        durationMs: Date.now() - started,
        skipped: false,
      };
    }
    const result = await runCommand(check.command, workspaceRoot, timeoutMs);
    return {
      check,
      passed: result.exitCode === 0,
      errors: result.exitCode !== 0 ? [result.stderr.slice(0, 500)] : [],
      warnings: [],
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      check,
      passed: false,
      errors: [msg],
      warnings: [],
      durationMs: Date.now() - started,
      skipped: msg.includes('ENOENT') || msg.includes('not found'),
      skipReason: msg,
    };
  }
}

export async function runStaticAnalysis(
  checks: AnalysisCheck[],
  workspaceRoot: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  runCommand: RunCommandFn = defaultRunCommand,
): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];
  for (const check of checks) {
    results.push(await runSingleCheck(check, workspaceRoot, timeoutMs, runCommand));
  }
  return results;
}

export function analysisResultsToWarningLines(results: AnalysisResult[]): string[] {
  return results
    .filter((r) => !r.passed && !r.skipped)
    .map((r) => `static-analysis:${r.check.type}:failed`);
}

/** 为 impl 阶段后追加可选 tsc 验证 stage 建议（不写入 workflow，仅 warnings / 文档）。 */
export function suggestVerificationStages(
  results: AnalysisResult[],
  existingStages: Stage[],
): Stage[] {
  const hasTscStage = existingStages.some(
    (s) => s.tool === 'code-runner' && /tsc/.test((s.toolConfig as { command?: string }).command ?? ''),
  );
  if (hasTscStage) {
    return [];
  }
  const tscFailed = results.some((r) => r.check.type === 'typescript' && !r.passed && !r.skipped);
  if (!tscFailed) {
    return [];
  }
  return [
    {
      id: 'stage_verify_tsc_suggested',
      title: '建议：TypeScript 类型检查（静态分析管道生成）',
      tool: 'code-runner',
      toolConfig: {
        type: 'code-runner',
        command: 'npx tsc -p tsconfig.json --noEmit',
        captureOutput: true,
        pathBase: 'workspace',
      },
      input: { sources: [{ type: 'user-input', label: 'hint' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'tscOutput', format: 'text' }],
      pauseAfter: false,
    },
  ];
}

function defaultTypeScriptCheck(_workspaceRoot: string): AnalysisCheck | undefined {
  return { type: 'typescript', tsconfigPath: 'tsconfig.json' };
}

/** 常见 extension 入口；不存在时跳过 imports check。 */
function defaultImportsCheck(workspaceRoot: string): AnalysisCheck | undefined {
  for (const candidate of ['src/extension.ts', 'src/index.ts', 'index.ts']) {
    if (fs.existsSync(path.join(workspaceRoot, candidate))) {
      return { type: 'imports', entryPoint: candidate };
    }
  }
  return undefined;
}

export function buildDefaultWorkspaceChecks(workspaceRoot: string): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  const tsc = defaultTypeScriptCheck(workspaceRoot);
  if (tsc && fs.existsSync(path.join(workspaceRoot, 'tsconfig.json'))) {
    checks.push(tsc);
  }
  const imports = defaultImportsCheck(workspaceRoot);
  if (imports) {
    checks.push(imports);
  }
  return checks;
}
