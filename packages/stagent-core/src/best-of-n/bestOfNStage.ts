/**
 * best-of-N 执行器接线（子任务 3b）：把 3a 的纯择优核（selectBestCandidate）接进 LLM 阶段执行。
 *
 * 设计要点：
 * - **择优不替代门**：对启用的高方差切片（默认 impl / test_write）跑 N 次候选，各候选用既有
 *   post-stage Strict-QA 门（module-contract / export-contract / test-quality / OutputQualityScorer）
 *   评分映射为 CandidateOutcome，selectBestCandidate 选优后**落定胜者**；胜者仍走既有完整门/test_run/smoke。
 * - **不伪绿**：全候选均未过静态 Strict-QA 时，回退到 ranked[0]（最优劣者）走既有门重试/失败路径，
 *   绝不降低验收标准。
 * - **候选隔离**：单产物切片用「逐候选落盘+即时评分+捕获结果」的时间序隔离（下一候选覆盖前已评分），
 *   最终重落胜者；多文件 bundle 切片不启用（见 bestOfNRoleForStage 排除）。
 * - 默认关（`execution.bestOfN.enabled`，strict true）；N 默认 3；仅对方差大的切片角色启用以控成本。
 */
import type { WorkspaceConfiguration } from '../platform/HostTypes';
import {
  readConfigBooleanStrictTrue,
  readConfigResolved,
} from '../settings/readers/readConfigHelpers';
import { isDecideStageId, isImplStageId, isTestWriteStageId } from '../workflow/StageIdPatterns';
import type { BestOfNSelection, CandidateOutcome } from './BestOfNTypes';
import { selectBestCandidate, summarizeCandidates } from './selectBestCandidate';

export type BestOfNRole = 'impl' | 'test_write' | 'decide';

export const DEFAULT_BEST_OF_N_COUNT = 3;
const MAX_BEST_OF_N_COUNT = 8;
const ALL_ROLES: readonly BestOfNRole[] = ['impl', 'test_write', 'decide'];
/** 默认只对 impl / test_write（生成方差最大）启用；decide 另有内容 lint，且全量 N× 成本高。 */
const DEFAULT_ROLES: readonly BestOfNRole[] = ['impl', 'test_write'];

export interface BestOfNConfig {
  enabled: boolean;
  n: number;
  roles: Set<BestOfNRole>;
}

function coerceCount(raw: unknown): number {
  const v = Number(raw);
  if (Number.isInteger(v) && v >= 1 && v <= MAX_BEST_OF_N_COUNT) {
    return v;
  }
  return DEFAULT_BEST_OF_N_COUNT;
}

function coerceRoles(raw: unknown): Set<BestOfNRole> {
  if (Array.isArray(raw)) {
    const picked = raw.filter((r): r is BestOfNRole => ALL_ROLES.includes(r as BestOfNRole));
    if (picked.length > 0) {
      return new Set(picked);
    }
  }
  return new Set(DEFAULT_ROLES);
}

/** 读取 best-of-N 配置（默认关；N=3；roles=impl/test_write）。 */
export function readBestOfNConfig(cfg?: WorkspaceConfiguration): BestOfNConfig {
  return {
    enabled: readConfigBooleanStrictTrue(cfg, 'execution.bestOfN.enabled'),
    n: readConfigResolved(cfg, 'execution.bestOfN.count', coerceCount, DEFAULT_BEST_OF_N_COUNT),
    roles: readConfigResolved(cfg, 'execution.bestOfN.roles', coerceRoles, new Set(DEFAULT_ROLES)),
  };
}

/**
 * 阶段的 best-of-N 角色：仅「主产物」impl / test_write / decide（排除 bundle-write / 自修复 /
 * replan / stub 等派生阶段，避免多文件/隔离复杂度与不必要的 N×）。无角色返回 null。
 */
export function bestOfNRoleForStage(stageId: string): BestOfNRole | null {
  if (!stageId || stageId.endsWith('_stagent_bundle_write')) {
    return null;
  }
  if (isTestWriteStageId(stageId)) {
    return 'test_write';
  }
  // fix_if_failed_* / materialize_stub_* 也以 stage_ 开头但不是主 impl；isImplStageId 仅匹配 stage_impl_
  if (isImplStageId(stageId)) {
    return 'impl';
  }
  if (isDecideStageId(stageId)) {
    return 'decide';
  }
  return null;
}

/** 该阶段应跑的候选次数：启用且角色命中 → N；否则 1（不改变既有单次行为）。 */
export function bestOfNCountForStage(stageId: string, config: BestOfNConfig): number {
  if (!config.enabled) {
    return 1;
  }
  const role = bestOfNRoleForStage(stageId);
  if (!role || !config.roles.has(role)) {
    return 1;
  }
  return Math.max(1, config.n);
}

export interface BestOfNCandidate<T> {
  outcome: CandidateOutcome;
  payload: T;
}

export interface BestOfNResult<T> {
  selection: BestOfNSelection;
  /** 胜者（通过 Strict-QA 的最优候选）。全失败时为 ranked[0]（最优劣者，仍走既有门）。 */
  chosen: BestOfNCandidate<T>;
  /** 是否有候选通过 Strict-QA（false = 全失败回退，调用方须走既有失败/重试路径，不得伪绿）。 */
  anyPassed: boolean;
  candidates: BestOfNCandidate<T>[];
  summary: { total: number; passed: number; failed: number };
}

/**
 * 纯编排（可注入、不抛）：跑 N 次「生成+评分」候选，selectBestCandidate 选优，返回胜者 payload。
 * 全失败时回退到排名最优劣者（chosen=ranked[0] 对应候选），并置 anyPassed=false 供调用方走既有门路径。
 * @param n 候选次数（≥1）
 * @param generateAndScore 第 i 次（0-based）生成并评分一个候选
 */
export async function runBestOfNCandidates<T>(
  n: number,
  generateAndScore: (index: number) => Promise<BestOfNCandidate<T>>,
): Promise<BestOfNResult<T>> {
  const count = Math.max(1, Math.floor(n));
  const candidates: BestOfNCandidate<T>[] = [];
  for (let i = 0; i < count; i++) {
    candidates.push(await generateAndScore(i));
  }
  const byId = new Map(candidates.map((c) => [c.outcome.id, c]));
  const selection = selectBestCandidate(candidates.map((c) => c.outcome));
  const summary = summarizeCandidates(candidates.map((c) => c.outcome));

  if (selection.selectedId && byId.has(selection.selectedId)) {
    return {
      selection,
      chosen: byId.get(selection.selectedId)!,
      anyPassed: true,
      candidates,
      summary,
    };
  }
  // 全失败：回退到排名最优劣者（ranked[0]）；调用方据 anyPassed=false 走既有门重试/失败，不伪绿。
  const fallbackId = selection.ranked[0]?.id;
  const chosen = (fallbackId && byId.get(fallbackId)) || candidates[0]!;
  return { selection, chosen, anyPassed: false, candidates, summary };
}
