import type { CodeRunnerCommandIssue } from './CodeRunnerCommandLint';
import {
  artifactHasPythonModule,
  artifactHasRelativePath,
  normalizeArtifactRelativePath,
  type WorkflowArtifactRegistry,
} from './WorkflowArtifactRegistry';

/** Python 标准库顶层模块（常见子集；非穷尽） */
const PYTHON_STDLIB_TOP_LEVEL = new Set([
  'sys',
  'os',
  'json',
  'logging',
  'random',
  'time',
  'pathlib',
  'typing',
  'datetime',
  'csv',
  're',
  'math',
  'uuid',
  'hashlib',
  'collections',
  'io',
  'traceback',
  'argparse',
  'subprocess',
  'unittest',
  'tempfile',
  'shutil',
  'functools',
  'itertools',
  'enum',
  'dataclasses',
  'abc',
  'copy',
  'struct',
  'socket',
  'http',
  'urllib',
  'email',
  'html',
  'xml',
  'sqlite3',
  'pickle',
  'base64',
  'secrets',
  'contextlib',
  'warnings',
  'textwrap',
  'string',
  'decimal',
  'fractions',
  'statistics',
  'bisect',
  'heapq',
  'queue',
  'threading',
  'multiprocessing',
  'asyncio',
  'concurrent',
  'importlib',
  'pkgutil',
  'venv',
  'platform',
  'getpass',
  'glob',
  'fnmatch',
  'linecache',
  'codecs',
  'locale',
  'gettext',
  'pprint',
]);

/**
 * 常见第三方包的 import 顶层名（import 名 ≠ pip 包名时也按 import 名登记，如 PyYAML→yaml、Pillow→PIL）。
 * 这是「即便没有 requirements.txt 也明显属于第三方」的兜底集；当 requirements.txt 已登记时，
 * classifyPythonImport 会进一步放行任意非冲突 import（见下）。
 */
const PYTHON_THIRD_PARTY_IMPORT_ALIASES: Record<string, true> = {
  yaml: true,
  pandas: true,
  requests: true,
  openpyxl: true,
  dotenv: true,
  numpy: true,
  scipy: true,
  matplotlib: true,
  sklearn: true,
  bs4: true,
  lxml: true,
  httpx: true,
  aiohttp: true,
  flask: true,
  fastapi: true,
  starlette: true,
  django: true,
  pydantic: true,
  pytest: true,
  dateutil: true,
  pytz: true,
  PIL: true,
  tabulate: true,
  tqdm: true,
  click: true,
  rich: true,
  typer: true,
  sqlalchemy: true,
  redis: true,
  pymongo: true,
  psycopg2: true,
  boto3: true,
  google: true,
  jinja2: true,
  xlsxwriter: true,
  xlrd: true,
};

function extractPythonCodeFromCommand(command: string): string | undefined {
  const m = command.match(
    /(?:^|[;&|]\s*)(?:\.\/)?(?:[^\s]*\/)?python(?:3)?\s+-c\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/,
  );
  if (!m) {
    return undefined;
  }
  const quoted = m[1];
  if (quoted.startsWith('"')) {
    return quoted.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  return quoted.slice(1, -1).replace(/\\'/g, "'").replace(/\\n/g, '\n');
}

function extractPythonTopLevelImports(code: string): string[] {
  const modules: string[] = [];
  const fromRe = /(?:^|[;\n])\s*from\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s+import\s+/g;
  const importRe = /(?:^|[;\n])\s*import\s+([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(code)) !== null) {
    modules.push(m[1].split('.')[0]);
  }
  while ((m = importRe.exec(code)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+/)[0].split('.')[0];
      if (name) {
        modules.push(name);
      }
    }
  }
  return modules;
}

function extractPythonScriptPaths(command: string): string[] {
  const paths: string[] = [];
  const scriptRe =
    /(?:^|[;&|]\s*)(?:\.\/)?(?:\.venv\/bin\/|venv\/bin\/)?python(?:3)?\s+(?!-c\b)([a-zA-Z_][\w./-]*\.py)\b/g;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(command)) !== null) {
    paths.push(normalizeArtifactRelativePath(m[1]));
  }
  return paths;
}

/** 非 .py artifact 的去扩展名 basename 集（如 config.yaml→config、mock_data.json→mock_data）。 */
function nonPyArtifactBaseNames(registry: WorkflowArtifactRegistry): Set<string> {
  const set = new Set<string>();
  for (const p of registry.paths) {
    if (/\.py$/i.test(p)) {
      continue;
    }
    const base = (p.split(/[/\\]/).pop() ?? '').replace(/\.[^.]+$/, '');
    if (base) {
      set.add(base);
    }
  }
  return set;
}

type PythonImportVerdict = 'allow' | 'flag-file-collision' | 'flag-undeclared';

/**
 * 判定 `python -c` 内联 import 的顶层模块：
 * - stdlib / 已生成 .py 模块 → allow
 * - 与某个非 .py artifact 同名（如 config.yaml 却写 `from config import`）→ flag-file-collision（高信号反模式）
 * - 已登记 requirements.txt（声明了第三方依赖）→ allow（生成期无法读取其内容，按 deps 文件存在判定，避免误拦 numpy/scipy 等）
 * - 已知常见第三方 import 名 → allow（即便无 requirements.txt）
 * - 否则（无 deps 文件且非已知三方且非本地模块）→ flag-undeclared
 */
function classifyPythonImport(moduleName: string, registry: WorkflowArtifactRegistry): PythonImportVerdict {
  const trimmed = moduleName.trim();
  if (!trimmed || PYTHON_STDLIB_TOP_LEVEL.has(trimmed)) {
    return 'allow';
  }
  if (artifactHasPythonModule(registry, trimmed)) {
    return 'allow';
  }
  if (nonPyArtifactBaseNames(registry).has(trimmed)) {
    return 'flag-file-collision';
  }
  if (registry.pathSet.has('requirements.txt')) {
    return 'allow';
  }
  if (PYTHON_THIRD_PARTY_IMPORT_ALIASES[trimmed]) {
    return 'allow';
  }
  return 'flag-undeclared';
}

/** M20.1：静态解析 code-runner 命令中的 Python import / 脚本路径 */
export function detectPythonImportLintIssues(
  command: string,
  registry: WorkflowArtifactRegistry,
  options?: { stageId?: string },
): CodeRunnerCommandIssue[] {
  if (!/(python|\.py\b|import\s|from\s)/i.test(command)) {
    return [];
  }
  const issues: CodeRunnerCommandIssue[] = [];
  const stageHint = options?.stageId ? `（阶段 ${options.stageId}）` : '';

  const pyCode = extractPythonCodeFromCommand(command);
  if (pyCode) {
    const seen = new Set<string>();
    for (const mod of extractPythonTopLevelImports(pyCode)) {
      if (seen.has(mod)) {
        continue;
      }
      seen.add(mod);
      const verdict = classifyPythonImport(mod, registry);
      if (verdict === 'allow') {
        continue;
      }
      const artifactsHint = ` 已登记 artifact：${registry.pythonModules.slice(0, 12).join(', ') || '(无 .py)'}`;
      if (verdict === 'flag-file-collision') {
        issues.push({
          code: 'python-c-import-not-in-artifacts',
          message:
            `Python -c 引用的模块「${mod}」与已登记的非 .py 文件同名${stageHint}（如 config.yaml）。` +
            `这通常是把数据/配置文件误当模块 import：请改用 open()/yaml.safe_load() 读取该文件；` +
            `若确需 ${mod} 模块，请增加 writeOutputToFile: ${mod}.py 阶段。` +
            artifactsHint,
        });
      } else {
        issues.push({
          code: 'python-c-import-not-in-artifacts',
          message:
            `Python -c 引用了既未在 writeOutputToFile/file-write 声明、也未在 requirements.txt 声明的模块「${mod}」${stageHint}。` +
            `请仅 import 已生成 .py（如 reader.py→import reader）；若为第三方包，请新增 requirements.txt 阶段并把该包写入。` +
            artifactsHint,
        });
      }
    }
  }

  for (const script of extractPythonScriptPaths(command)) {
    if (artifactHasRelativePath(registry, script)) {
      continue;
    }
    issues.push({
      code: 'python-script-not-in-artifacts',
      message:
        `code-runner 执行脚本「${script}」未出现在工作流 artifact 登记中${stageHint}。` +
        `请确保存在对应 writeOutputToFile 阶段或修正 command 路径。`,
    });
  }

  return issues;
}
