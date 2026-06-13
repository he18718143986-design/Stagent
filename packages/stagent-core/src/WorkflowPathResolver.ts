import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkflowDefinition } from './WorkflowDefinition';
import { getDefaultTaskDir } from './WorkflowPersistence';

/** `~` / `~/x` 展开为绝对用户目录；其余原样返回（已 trim）。 */
export function expandUserHomePath(raw: string): string {
  const t = raw.trim();
  if (t === '~') {
    return os.homedir();
  }
  if (t.startsWith('~/') || t.startsWith('~\\')) {
    return path.join(os.homedir(), t.slice(2));
  }
  return t;
}

/** 校验用户输入的工作区根路径：存在且为目录，返回绝对路径。 */
export function resolveExistingDirectoryPath(
  raw: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: '请填写「工作文件夹」路径（生成与后续执行将落在该目录下的 .stagent/instances/…）。',
    };
  }
  const expanded = expandUserHomePath(trimmed);
  const abs = path.resolve(expanded);
  try {
    if (!fs.existsSync(abs)) {
      return { ok: false, reason: `工作文件夹不存在：${abs}` };
    }
    if (!fs.statSync(abs).isDirectory()) {
      return { ok: false, reason: `工作文件夹路径不是目录：${abs}` };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `无法访问工作文件夹：${abs}（${detail}）` };
  }
  return { ok: true, abs };
}

/**
 * 从实例 taskDir 反推工作区根：`<ws>/.stagent/instances/<id>` → `<ws>`。
 * taskDir 结构不符时返回 undefined。
 */
export function workspaceRootFromTaskDir(taskDir?: string): string | undefined {
  if (!taskDir?.trim()) {
    return undefined;
  }
  const instancesDir = path.dirname(path.resolve(taskDir));
  if (path.basename(instancesDir) !== 'instances') {
    return undefined;
  }
  const stagentDir = path.dirname(instancesDir);
  if (path.basename(stagentDir) !== '.stagent') {
    return undefined;
  }
  return path.dirname(stagentDir);
}

/**
 * 将 meta.taskWorkspacePath 钉死为绝对路径。
 * 相对路径优先相对 taskDir 所属工作区解析，避免执行期 cwd 变化导致 `../T4` 漂移。
 */
export function pinTaskWorkspacePathAbsolute(
  taskWorkspacePath: string | undefined,
  taskDirHint?: string,
): string | undefined {
  const fromTaskDir = workspaceRootFromTaskDir(taskDirHint);
  const raw = taskWorkspacePath?.trim();
  if (!raw) {
    return fromTaskDir;
  }
  const expanded = expandUserHomePath(raw);
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  if (fromTaskDir) {
    return path.resolve(fromTaskDir, expanded);
  }
  return path.resolve(expanded);
}

/** `meta.taskWorkspacePath` 解析为绝对路径；缺失/空白时尝试 taskDir 反推。 */
export function resolveWorkspaceRootAbsolute(
  taskWorkspacePath?: string,
  taskDirHint?: string,
): string | undefined {
  const pinned = pinTaskWorkspacePathAbsolute(taskWorkspacePath, taskDirHint);
  if (pinned) {
    return pinned;
  }
  return workspaceRootFromTaskDir(taskDirHint);
}

/** 将 relativePath 限制在 root 之下，防止 `..` 逃逸；越界抛错。 */
export function safeJoinUnderWorkspaceRoot(root: string, relativePath: string): string {
  const r = path.resolve(root);
  const joined = path.resolve(r, relativePath);
  const rel = path.relative(r, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径逃出工作区根目录: ${relativePath}`);
  }
  return joined;
}

/** 可读项目根：当前 vscode 工作区根（若有）+ `process.cwd()`（去重）。 */
export function getReadableProjectRoots(workspaceRoot?: string): string[] {
  const out: string[] = [];
  if (workspaceRoot) {
    out.push(workspaceRoot);
  }
  const cwd = process.cwd();
  if (cwd && !out.includes(cwd)) {
    out.push(cwd);
  }
  return out;
}

const ZOOM_OUT_FALLBACK_CANDIDATES = [
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'README.md',
  'src/index.ts',
  'src/main.ts',
  'src/app.ts',
];

/** 在 roots 下挑选首个存在的 zoom-out 可读文件；均不存在时回退 preferred 或 package.json。 */
export function pickZoomOutFilePath(roots: string[], preferred?: string): string {
  const candidates = [preferred?.trim(), ...ZOOM_OUT_FALLBACK_CANDIDATES].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  for (const rel of candidates) {
    if (path.isAbsolute(rel)) {
      if (fs.existsSync(rel)) {
        return rel;
      }
      continue;
    }
    for (const root of roots) {
      if (fs.existsSync(path.join(root, rel))) {
        return rel;
      }
    }
  }
  return preferred?.trim() || 'package.json';
}

/**
 * 新实例 `taskDir`：`meta.taskWorkspacePath` → `<根>/.stagent/instances/<id>`；否则回退已打开工作区。
 * `workspaceRoot` 为当前 vscode 工作区根（无则 undefined），`globalStoragePath` 为扩展全局存储路径。
 */
export function resolveInitialTaskDir(
  instanceId: string,
  wf: WorkflowDefinition,
  workspaceRoot: string | undefined,
  globalStoragePath: string,
): { ok: true; dir: string } | { ok: false; reason: string } {
  const raw = wf.meta?.taskWorkspacePath?.trim();
  if (raw) {
    const dirCheck = resolveExistingDirectoryPath(raw);
    if (!dirCheck.ok) {
      return { ok: false, reason: dirCheck.reason };
    }
    return { ok: true, dir: path.join(dirCheck.abs, '.stagent', 'instances', instanceId) };
  }
  if (!workspaceRoot) {
    return {
      ok: false,
      reason:
        '缺少任务工作目录：请在输入页填写「工作文件夹」并重新生成工作流，或打开 VS Code 工作区文件夹后重试。',
    };
  }
  return {
    ok: true,
    dir: getDefaultTaskDir(instanceId, workspaceRoot, globalStoragePath),
  };
}

/**
 * 预执行草稿壳 taskDir：有效 taskWorkspacePath → 工作区下 instances；否则回退 globalStorage。
 * 供润色/澄清/生成在实例创建前统一写入 `.wf-debug.log`。
 */
export function resolvePreExecTaskDir(
  instanceId: string,
  taskWorkspacePathRaw: string | undefined,
  _workspaceRoot: string | undefined,
  globalStoragePath: string,
): { ok: true; dir: string } | { ok: false; reason: string } {
  const raw = taskWorkspacePathRaw?.trim();
  if (raw) {
    const dirCheck = resolveExistingDirectoryPath(raw);
    if (!dirCheck.ok) {
      return { ok: false, reason: dirCheck.reason };
    }
    return { ok: true, dir: path.join(dirCheck.abs, '.stagent', 'instances', instanceId) };
  }
  return { ok: true, dir: getDefaultTaskDir(instanceId, undefined, globalStoragePath) };
}
