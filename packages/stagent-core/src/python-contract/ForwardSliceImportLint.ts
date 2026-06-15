/**
 * Run #53 根治：绿场垂直切片按序推进时，较早切片 impl 禁止顶层 import 尚未落盘的后续切片
 * （如 risk 阶段 `from broker import SimBroker` 而 broker/ 尚不存在 → pytest 收集期 ModuleNotFoundError）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import {
  GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
  semanticNameFromDecideStageId,
} from '../workflow/StageIdPatterns';
import { parsePythonImportRoots } from './PythonDeclaredDependenciesLint';
import { isExternalPythonModuleRoot } from './pythonExternalModules';
import { isPythonStdlibRoot } from './pythonStdlibRoots';

export interface ForwardSliceImportIssue {
  code: 'python-forward-slice-import';
  message: string;
  importedModule: string;
}

/** 从 plan 中 decide 阶段出现顺序提取切片语义名（不含 architecture_overview）。 */
export function collectWorkflowSliceOrder(definition: WorkflowDefinition): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const stage of definition.stages ?? []) {
    if (stage.id === GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID) {
      continue;
    }
    const semantic = semanticNameFromDecideStageId(stage.id);
    if (!semantic || seen.has(semantic)) {
      continue;
    }
    seen.add(semantic);
    order.push(semantic);
  }
  return order;
}

export function laterSlicesInWorkflow(currentSemantic: string, sliceOrder: string[]): string[] {
  const idx = sliceOrder.indexOf(currentSemantic);
  if (idx < 0) {
    return [];
  }
  return sliceOrder.slice(idx + 1);
}

export function projectModuleExistsOnDisk(workspaceRoot: string, moduleName: string): boolean {
  const pkg = path.join(workspaceRoot, moduleName, '__init__.py');
  const flat = path.join(workspaceRoot, `${moduleName}.py`);
  return fs.existsSync(pkg) || fs.existsSync(flat);
}

export function lintForwardSliceImportsInImpl(params: {
  workspaceRoot: string;
  implRelPath: string;
  currentSemantic: string;
  sliceOrder: string[];
}): ForwardSliceImportIssue | null {
  const { workspaceRoot, implRelPath, currentSemantic, sliceOrder } = params;
  const later = new Set(laterSlicesInWorkflow(currentSemantic, sliceOrder).map((s) => s.toLowerCase()));
  if (later.size === 0) {
    return null;
  }
  const abs = path.join(workspaceRoot, implRelPath);
  let content = '';
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  for (const root of parsePythonImportRoots(content)) {
    const mod = root.toLowerCase();
    if (mod === currentSemantic.toLowerCase()) {
      continue;
    }
    if (isPythonStdlibRoot(mod) || isExternalPythonModuleRoot(mod)) {
      continue;
    }
    if (!later.has(mod)) {
      continue;
    }
    if (projectModuleExistsOnDisk(workspaceRoot, mod)) {
      continue;
    }
    return {
      code: 'python-forward-slice-import',
      message: `${implRelPath} 顶层 import 后续切片模块 \`${mod}\`（${currentSemantic} 阶段时 ${mod}/ 尚未落盘）。禁止 \`from ${mod} import …\`；对冲/跨切片依赖改用函数内 lazy import、可注入 callable（如 settlement_price_resolver），或接受参数由 main 装配时再接 ${mod}。`,
      importedModule: mod,
    };
  }
  return null;
}

/**
 * impl 阶段预防：在初始实现前告知模型——本切片之后的切片尚未落盘，禁止顶层 import。
 * 与静态门 `lintForwardSliceImportsInImpl` 同源（避免一撞门就 hard block），无后续切片时返回 null。
 */
export function buildForwardSliceImportPreventionSuffix(params: {
  currentSemantic: string;
  sliceOrder: string[];
}): string | null {
  const { currentSemantic, sliceOrder } = params;
  const later = laterSlicesInWorkflow(currentSemantic, sliceOrder);
  if (later.length === 0) {
    return null;
  }
  const list = later.map((s) => `\`${s}\``).join('、');
  return [
    '## 前向切片 import 约束（必须遵守）',
    `本切片 \`${currentSemantic}\` 按工作流顺序先于以下切片实现，落盘时它们尚不存在：${list}。`,
    '禁止在模块顶层 `import` / `from … import` 这些后续切片——会在测试收集期（pytest）触发 ModuleNotFoundError，并被 module-contract 门硬拦。',
    '如必须依赖后续切片：① 在函数内部 lazy import；② 或声明可注入 callable / 参数（如 settlement_price_resolver），由 main 装配时再接；③ 测试若 patch 后续切片符号，impl 在调用点 lazy import 即可。',
  ].join('\n');
}

/** fix 链：pytest ModuleNotFoundError 命中尚未落盘的后续切片时注入可操作提示。 */
export function buildForwardSliceImportFixHints(params: {
  diagnostic: string;
  currentSemantic: string | undefined;
  sliceOrder: string[];
}): string[] {
  const { diagnostic, currentSemantic, sliceOrder } = params;
  if (!currentSemantic || !/No module named/i.test(diagnostic)) {
    return [];
  }
  const modMatch = /No module named ['"]?([^'"\s]+)/i.exec(diagnostic);
  const missing = modMatch?.[1]?.split('.')[0]?.toLowerCase();
  if (!missing) {
    return [];
  }
  const later = laterSlicesInWorkflow(currentSemantic, sliceOrder).map((s) => s.toLowerCase());
  if (!later.includes(missing)) {
    return [];
  }
  return [
    `- 后续切片 \`${missing}\` 尚未实现（${currentSemantic} 先于 ${missing} 跑 test_run）：禁止 impl 顶层 \`from ${missing} import …\`。`,
    `- 修复策略：在 ${currentSemantic}/__init__.py 内用函数内 \`import ${missing}\`（lazy）或 \`settlement_price_resolver: Callable[[str], float]\` 参数/模块级可注入 hook；测试继续 patch \`${missing}.SimBroker.get_settlement_price\` 时 impl 须在调用点 lazy import。`,
    `- 禁止改 test 文件名；禁止要求提前 materialize ${missing}（由工作流顺序保证）。`,
  ];
}
