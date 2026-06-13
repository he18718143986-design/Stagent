/**
 * demo 产物客观验收 gate（纯函数，便于离线单测与 postStageGates 接线）。
 *
 * 刻意不查：摘要数值是否正确、图好不好看、策略是否盈利——这些归人/回测。
 * 风格对齐 BehaviorSpecLint：纯函数 + `{ code, message, hard }` issue。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DemoArtifactIssue {
  code:
    | 'demo-run-failed'
    | 'demo-summary-missing'
    | 'demo-summary-empty'
    | 'demo-summary-invalid-json'
    | 'demo-summary-schema'
    | 'demo-quickstart-missing'
    | 'demo-plot-invalid';
  message: string;
  /** hard 档下是否阻断（warn 档一律降级为告警）。 */
  hard: boolean;
}

export interface DemoArtifactGateOptions {
  /** stage_demo_run 退出码（runtime `_exitCode`）；非 0 → demo-run-failed。 */
  exitCode?: number;
  summaryRelPath?: string;
  summarySchemaRelPath?: string;
  quickstartRelPath?: string;
  /** 默认 true：缺 QUICKSTART.md 视为 hard。 */
  requireQuickstart?: boolean;
  /** 显式必需键；优先于 summary.schema.json 的 requiredKeys。 */
  requiredSummaryKeys?: string[];
  /** P1 图表产物相对路径（仅当 requirePlot 时校验）。 */
  plotRelPath?: string;
  /** 默认 false。 */
  requirePlot?: boolean;
}

const DEFAULT_SUMMARY_REL = 'demo/summary.json';
const DEFAULT_SUMMARY_SCHEMA_REL = 'demo/summary.schema.json';
const DEFAULT_QUICKSTART_REL = 'QUICKSTART.md';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_PLOT_BYTES = 100;

function readFileIfExists(abs: string): string | null {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return null;
    }
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function resolveRequiredKeys(
  workspaceRootAbs: string,
  options: DemoArtifactGateOptions,
): string[] {
  if (options.requiredSummaryKeys?.length) {
    return options.requiredSummaryKeys;
  }
  const schemaRel = options.summarySchemaRelPath ?? DEFAULT_SUMMARY_SCHEMA_REL;
  const schemaText = readFileIfExists(path.join(workspaceRootAbs, schemaRel));
  if (!schemaText) {
    return [];
  }
  try {
    const parsed = JSON.parse(schemaText) as { requiredKeys?: unknown };
    if (Array.isArray(parsed.requiredKeys)) {
      return parsed.requiredKeys.filter((k): k is string => typeof k === 'string' && k.length > 0);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function lintSummary(workspaceRootAbs: string, options: DemoArtifactGateOptions): DemoArtifactIssue[] {
  const issues: DemoArtifactIssue[] = [];
  const summaryRel = options.summaryRelPath ?? DEFAULT_SUMMARY_REL;
  const abs = path.join(workspaceRootAbs, summaryRel);
  const text = readFileIfExists(abs);
  if (text === null) {
    issues.push({
      code: 'demo-summary-missing',
      message: `缺少 ${summaryRel}`,
      hard: true,
    });
    return issues;
  }
  if (!text.trim()) {
    issues.push({
      code: 'demo-summary-empty',
      message: `${summaryRel} 为空`,
      hard: true,
    });
    return issues;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    issues.push({
      code: 'demo-summary-invalid-json',
      message: `${summaryRel} 不是合法 JSON 对象`,
      hard: true,
    });
    return issues;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    issues.push({
      code: 'demo-summary-invalid-json',
      message: `${summaryRel} 须为 JSON 对象（非数组/标量）`,
      hard: true,
    });
    return issues;
  }
  const required = resolveRequiredKeys(workspaceRootAbs, options);
  for (const key of required) {
    const val = (parsed as Record<string, unknown>)[key];
    if (val === undefined || val === null || val === '') {
      issues.push({
        code: 'demo-summary-schema',
        message: `${summaryRel} 缺必需键 "${key}"`,
        hard: true,
      });
    }
  }
  return issues;
}

function lintQuickstart(workspaceRootAbs: string, options: DemoArtifactGateOptions): DemoArtifactIssue[] {
  if (options.requireQuickstart === false) {
    return [];
  }
  const rel = options.quickstartRelPath ?? DEFAULT_QUICKSTART_REL;
  const text = readFileIfExists(path.join(workspaceRootAbs, rel));
  if (text === null || !text.trim()) {
    return [
      {
        code: 'demo-quickstart-missing',
        message: `缺少 ${rel}`,
        hard: true,
      },
    ];
  }
  return [];
}

function lintPlot(workspaceRootAbs: string, options: DemoArtifactGateOptions): DemoArtifactIssue[] {
  if (!options.requirePlot) {
    return [];
  }
  const rel = options.plotRelPath ?? 'demo/equity.png';
  const abs = path.join(workspaceRootAbs, rel);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return [
        {
          code: 'demo-plot-invalid',
          message: `图表产物缺失：${rel}`,
          hard: false,
        },
      ];
    }
    const buf = fs.readFileSync(abs);
    if (buf.length < MIN_PLOT_BYTES || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      return [
        {
          code: 'demo-plot-invalid',
          message: `图表产物无效（非 PNG 或过小）：${rel}`,
          hard: false,
        },
      ];
    }
  } catch {
    return [
      {
        code: 'demo-plot-invalid',
        message: `无法读取图表产物：${rel}`,
        hard: false,
      },
    ];
  }
  return [];
}

export function evaluateDemoArtifacts(
  workspaceRootAbs: string,
  options: DemoArtifactGateOptions = {},
): DemoArtifactIssue[] {
  const issues: DemoArtifactIssue[] = [];
  if (options.exitCode != null && options.exitCode !== 0) {
    issues.push({
      code: 'demo-run-failed',
      message: `demo 运行失败：exit ${options.exitCode}（应一次性跑完并 exit 0）`,
      hard: true,
    });
    return issues;
  }
  issues.push(...lintSummary(workspaceRootAbs, options));
  issues.push(...lintQuickstart(workspaceRootAbs, options));
  issues.push(...lintPlot(workspaceRootAbs, options));
  return issues;
}

export function hardDemoIssues(issues: DemoArtifactIssue[]): DemoArtifactIssue[] {
  return issues.filter((i) => i.hard);
}

export function demoIssuesToWarnings(issues: DemoArtifactIssue[]): string[] {
  return issues.map((i) => `demo-artifact（${i.code}）：${i.message}`);
}
