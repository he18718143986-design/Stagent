import type { Stage, StageRuntime, WorkflowDefinition } from '../WorkflowDefinition';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { coerceDecisionArtifacts } from '../python-contract/ModuleContractLint';
import {
  decideStageIdFromSemanticName,
  GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
  isImplStageId,
  isTestWriteStageId,
  semanticNameFromImplStageId,
  semanticNameFromTestWriteStageId,
} from '../workflow/StageIdPatterns';
import { isStagentRepairStage } from '../WorkflowStructuralRepair';
import { resolveModuleExports } from './decisionArtifactsSchema';

export function resolveSliceDecisionRecord(
  sliceRt: { approvedDecisionRecord?: string; outputs?: Record<string, unknown> } | undefined,
): string | undefined {
  const approved = sliceRt?.approvedDecisionRecord?.trim();
  if (approved) {
    return approved;
  }
  const raw = sliceRt?.outputs?.decisionRecord;
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

export function semanticNameFromContractStage(stage: Stage): string | undefined {
  return semanticNameFromTestWriteStageId(stage.id) ?? semanticNameFromImplStageId(stage.id);
}

/** slice sidecar → decisionRecord 正文 → global；与 module-contract / materialize_stub 同源。 */
export function resolveSliceContractExports(
  wf: WorkflowDefinition,
  runtimes: StageRuntime[],
  semantic: string,
): string[] | null {
  const decideId = decideStageIdFromSemanticName(semantic);
  const sliceRt = runtimes.find((r) => r.stageId === decideId);
  const globalRt = runtimes.find((r) => r.stageId === GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID);
  return resolveModuleExports(
    semantic,
    coerceDecisionArtifacts(sliceRt?.outputs?.[DECISION_ARTIFACTS_OUTPUT_KEY]),
    coerceDecisionArtifacts(globalRt?.outputs?.[DECISION_ARTIFACTS_OUTPUT_KEY]),
    resolveSliceDecisionRecord(sliceRt),
  );
}

/**
 * 运行时注入 test_write / impl：契约 exports SSOT，覆盖骨架 fillSkeleton 静态示例。
 */
export function buildSliceContractExportsPromptSuffix(
  wf: WorkflowDefinition,
  runtimes: StageRuntime[],
  stage: Stage,
): string | undefined {
  if (!isTestWriteStageId(stage.id) && !isImplStageId(stage.id)) {
    return undefined;
  }
  const semantic = semanticNameFromContractStage(stage);
  if (!semantic) {
    return undefined;
  }
  const exports = resolveSliceContractExports(wf, runtimes, semantic);
  if (!exports?.length) {
    return undefined;
  }

  const mod = semantic;
  const lines = [
    '【契约 exports SSOT（运行时 · 覆盖 systemPrompt 中其它 exports 示例）】',
    `本切片 decisionArtifacts.modules（slice decide 优先）唯一允许的公开符号：`,
    ...exports.map((s) => `- ${s}`),
    `from ${mod} import <仅上述符号>；禁止 import 未列符号（含计划期示例名）。`,
    // (a) 协作者 import 来源纪律（子任务 1d，补 order-aware 门的预防侧 / ADR-0007 prevention-at-impl）：
    `需要其它切片的符号时，从该切片**各自模块名**直接 import（如 \`from store import TaskStore\`、\`from models import validate_task\`）；`,
    `**严禁** \`from ${mod} import <其它切片符号>\`（如 \`from main import TaskStore\`——TaskStore 属 store，不属 main）；`,
    `**禁止**把 Python 内置/标准库符号（\`PermissionError\`、\`FileNotFoundError\` 等）当作本切片或他切片的模块级符号 import——内置直接使用即可，不需 import，更不应列入契约。`,
  ];

  if (semantic === 'main') {
    lines.push(
      'main 切片 export 必须是入口函数名（main 或 run），禁止将 CLI 参数 --mode 误写为 export 符号。',
      'main 仅编排：测试/实现需要协作者类与函数时从其真实模块 import（from store import TaskStore、from pipeline import import_tasks_from_csv），绝不 from main import 这些协作者。',
    );
  }

  if (isTestWriteStageId(stage.id)) {
    lines.push('test_write 须写行为级 pytest，且 import 集合与上表完全一致。');
    lines.push(
      'mock/patch 其它切片符号时须指向真实模块已声明 export（如 broker.SimBroker、indicators.compute_ma），禁止 patch 架构粗粒度名（如 compute_indicators）或本切片未声明符号。',
    );
    // (c) 测试隔离 + patch 目标纪律（子任务 1d）：避免 post-strict 复跑因 cwd 文件缺失 / patch 落空而红。
    lines.push(
      '测试隔离：凡读写文件（config.yaml / CSV / 输出 JSON）的用例必须用 `tmp_path` + `monkeypatch.chdir(tmp_path)` 自建所需 fixture（含被读取的 CSV），禁止依赖工作区既有文件或当前工作目录状态。',
      'patch 目标须是「被测模块**绑定后**的名字」：若 `main.py` 写 `from pipeline import import_tasks_from_csv`，则 patch `main.import_tasks_from_csv`（而非 `pipeline.import_tasks_from_csv`），否则 patch 落空、真实函数被调用导致 FileNotFoundError 等。',
    );
  } else {
    lines.push(
      'impl 须在模块顶层 def/class 导出上表符号，供上述 test import。',
      '模块顶层**仅**导出契约符号；内部 helper 必须 `_` 前缀或定义在函数/类内部（禁止模块级未声明 class/def，如 DataPipeline）。',
      // (b) 字段透传纪律（子任务 1d）：把外部数据导入领域对象时，须透传数据声明的所有字段（如 status），
      // 缺省值仅用于「字段缺失/为空」时，不得在解析后丢弃已读到的值。
      '把外部数据（CSV 行等）导入领域对象/store 时，必须**透传**该行已声明且已解析的字段（如 `status`）——'
        + '若仓储构造方法不接受该字段（如 `add(title, priority)` 固定 status="todo"），须在创建后**显式更新**'
        + '（`tid = store.add(...); store.update(tid, status=status)`）；缺省值仅在字段缺失/为空时使用，'
        + '不得解析出 `status` 后又丢弃（会产出语义错误的统计，被冒烟产出断言判红）。',
    );
  }

  return lines.join('\n');
}

/** main 等集成切片 test_write：列出各切片契约 exports，供 mock.patch 目标 SSOT（T4 Run #49）。 */
export function buildCrossModulePatchExportsPromptSuffix(
  wf: WorkflowDefinition,
  runtimes: StageRuntime[],
  stage: Stage,
): string | undefined {
  if (!isTestWriteStageId(stage.id)) {
    return undefined;
  }
  const semantic = semanticNameFromTestWriteStageId(stage.id);
  if (semantic !== 'main') {
    return undefined;
  }
  const peerModules = new Set<string>();
  for (const s of wf.stages ?? []) {
    if (!isImplStageId(s.id) || isStagentRepairStage(s)) {
      continue;
    }
    const mod = semanticNameFromImplStageId(s.id);
    if (mod && mod !== semantic && mod !== 'conftest') {
      peerModules.add(mod);
    }
  }
  if (peerModules.size === 0) {
    return undefined;
  }
  const lines = [
    '【跨模块 mock.patch SSOT（main 集成测试 · 运行时）】',
    'unittest.mock.patch / pytest mocker.patch 的字符串目标必须是 `<模块>.<下方已声明 export>`；',
    '禁止 patch compute / check_multi / evaluate 等架构示例名或未在 exports 中的符号。',
  ];
  for (const mod of [...peerModules].sort()) {
    const exports = resolveSliceContractExports(wf, runtimes, mod);
    if (!exports?.length) {
      continue;
    }
    lines.push(`- ${mod}: ${exports.join(', ')}`);
    lines.push(`  合法示例：patch("${mod}.${exports[0]}")`);
  }
  lines.push(
    'from main import 仅 main 切片 exports 中的符号；勿 import 未声明的 main。',
  );
  return lines.join('\n');
}
