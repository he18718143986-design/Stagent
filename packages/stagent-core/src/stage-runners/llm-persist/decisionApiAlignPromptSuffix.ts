import type { Stage, StageRuntime, WorkflowDefinition } from '../../WorkflowDefinition';
import {
  implStageIdFromSemanticName,
  isImplStageId,
  isTestWriteStageId,
  semanticNameFromTestWriteStageId,
} from '../../workflow/StageIdPatterns';
import { resolveSlicePythonImportModuleName } from './testImportBridgePromptSuffix';

const MODULE_CONTRACT_RE = /MODULE_CONTRACT\s*[:：]\s*(?:[\w.]+\.)?(\w+)\s*\(/gi;
const COLON_LIST_RE = /[：:]\s*([a-zA-Z_]\w*(?:\s*[,，、]\s*[a-zA-Z_]\w*)+)/g;
const FUNC_PAREN_RE = /\b([a-zA-Z_]\w*)\s*\(\s*\)/g;
const CLASS_RE = /\bclass\s+([A-Z]\w*)/g;

const SKIP_IDENT = new Set([
  'if',
  'for',
  'def',
  'class',
  'from',
  'import',
  'None',
  'True',
  'False',
  'main',
  'pytest',
  'MVP',
  'Python',
  'CLI',
  'CSV',
]);

function addIdentifier(out: Set<string>, name: string | undefined): void {
  const n = name?.trim();
  if (!n || SKIP_IDENT.has(n) || n.length < 2) {
    return;
  }
  out.add(n);
}

/** 从决策正文 / impl prompt 抽取公开 API 符号名。 */
export function parsePublicApiSymbolsFromText(text: string): string[] {
  const symbols = new Set<string>();
  const src = text.trim();
  if (!src) {
    return [];
  }

  MODULE_CONTRACT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MODULE_CONTRACT_RE.exec(src)) !== null) {
    addIdentifier(symbols, m[1]);
  }

  COLON_LIST_RE.lastIndex = 0;
  while ((m = COLON_LIST_RE.exec(src)) !== null) {
    for (const part of m[1]!.split(/[,，、]/)) {
      addIdentifier(symbols, part.replace(/\s*\(.*$/, '').trim());
    }
  }

  FUNC_PAREN_RE.lastIndex = 0;
  while ((m = FUNC_PAREN_RE.exec(src)) !== null) {
    addIdentifier(symbols, m[1]);
  }

  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(src)) !== null) {
    addIdentifier(symbols, m[1]);
  }

  return [...symbols].sort((a, b) => a.localeCompare(b));
}

/** 优先解析 impl prompt 中含「类/函数/指标/信号」的行，减少噪声。 */
export function extractApiSymbolsFromImplPrompt(prompt: string): string[] {
  const focused = (prompt ?? '')
    .split('\n')
    .filter((line) => /类|函数|API|指标|信号|风控|券商|MODULE_CONTRACT|包含以下/i.test(line))
    .join('\n');
  return parsePublicApiSymbolsFromText(focused || prompt);
}

function findPairedImplStage(wf: WorkflowDefinition, testWriteStage: Stage): Stage | undefined {
  const semantic = semanticNameFromTestWriteStageId(testWriteStage.id);
  if (!semantic) {
    return undefined;
  }
  return wf.stages?.find((s) => s.id === implStageIdFromSemanticName(semantic));
}

function collectApprovedDecisionRecords(
  wf: WorkflowDefinition,
  runtimes: StageRuntime[],
  stage: Stage,
): string[] {
  const fromSources = new Set(
    (stage.input?.sources ?? [])
      .filter((s) => s.type === 'stage-output' && s.outputKey === 'decisionRecord' && s.stageId?.trim())
      .map((s) => s.stageId!.trim()),
  );
  const records: string[] = [];
  for (let i = 0; i < (wf.stages?.length ?? 0); i++) {
    const st = wf.stages![i]!;
    if (st.isDecisionStage !== true) {
      continue;
    }
    if (fromSources.size > 0 && !fromSources.has(st.id)) {
      continue;
    }
    const rt = runtimes[i];
    const rec = String(rt?.approvedDecisionRecord ?? rt?.outputs?.decisionRecord ?? '').trim();
    if (rec) {
      records.push(rec);
    }
  }
  return records;
}

export function collectSlicePublicApiSymbols(
  wf: WorkflowDefinition,
  runtimes: StageRuntime[],
  stage: Stage,
  pairedImpl?: Stage,
): string[] {
  const symbols = new Set<string>();
  for (const rec of collectApprovedDecisionRecords(wf, runtimes, stage)) {
    for (const s of parsePublicApiSymbolsFromText(rec)) {
      symbols.add(s);
    }
  }
  const implStage =
    pairedImpl ??
    (isImplStageId(stage.id) ? stage : undefined);
  if (implStage?.toolConfig?.type === 'llm-text') {
    for (const s of extractApiSymbolsFromImplPrompt(implStage.toolConfig.systemPrompt ?? '')) {
      symbols.add(s);
    }
  }
  return [...symbols].sort((a, b) => a.localeCompare(b));
}

/**
 * 运行时追加到 stage_impl_* / stage_test_write_*：强制测试与实现共用同一 API 符号表。
 */
export function buildApiAlignPromptSuffix(
  wf: WorkflowDefinition,
  runtimes: StageRuntime[],
  stage: Stage,
): string | undefined {
  if (!isTestWriteStageId(stage.id) && !isImplStageId(stage.id)) {
    return undefined;
  }

  const pairedImpl = isTestWriteStageId(stage.id) ? findPairedImplStage(wf, stage) : undefined;
  const symbols = collectSlicePublicApiSymbols(wf, runtimes, stage, pairedImpl);
  if (symbols.length === 0) {
    return undefined;
  }

  const lines = [
    '【公开 API 符号对齐（运行时）】',
    '以下符号来自已批准决策清单与本切片 impl systemPrompt；实现与测试必须使用**完全一致**的名称（禁止 calculate_ma / calc_ma 等别名）：',
    ...symbols.map((s) => `- ${s}`),
  ];

  if (isTestWriteStageId(stage.id)) {
    const mod = resolveSlicePythonImportModuleName(wf, stage);
    if (mod) {
      lines.push(
        `测试 import 目标：from ${mod} import <上述符号>（impl 可为 ${mod}/__init__.py，禁止 from __init__ import）`,
      );
    }
    lines.push('禁止 invent 未列出的符号名；若与 impl 已落盘代码冲突，以本列表与决策清单为准。');
  } else {
    lines.push('实现代码中的 def/class 名称必须与上表一致，供 test 通过 from 切片模块名 import。');
  }

  return lines.join('\n');
}
