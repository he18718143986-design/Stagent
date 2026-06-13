import { GATE_ID_PYTHON_EXPORT_CONTRACT, GATE_ID_PYTHON_PYPI_SYMBOL } from '../QualityGateIds';
import { findLastImplStageIndex } from '../TddSliceScope';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { findFixStageAnchor } from './FixExhaustedRouter';
import {
  buildConftestReplanStage,
  buildFixExhaustedReplanStage,
  buildGateReplanLlmStage,
  buildPipPytestAsyncioReplanStage,
  buildPostTestfixImplReplanStage,
  buildTestRewriteReplanStage,
} from './buildReplanStage';
import {
  RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX,
  RUNTIME_REPLAN_STAGE_ID_PREFIX,
  RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX,
} from './constants';
import { canSpendReplanBudget, defaultRuntimeReplanBudget } from './replanBudget';
import type { RuntimeReplanAction, RuntimeReplanTrigger } from './types';
import { readReplanLedger } from './types';

function findAnchorForPip(trigger: RuntimeReplanTrigger, instance: WorkflowInstance): string | undefined {
  const stages = instance.definition.stages;
  const pip = [...stages].reverse().find((s) => s.id.includes('venv_pip') || s.id === 'stage_venv_pip_install');
  if (pip) {
    return pip.id;
  }
  const create = stages.find((s) => s.id === 'stage_venv_create' || s.id.includes('venv_create'));
  return create?.id;
}

function findLastImplAnchor(instance: WorkflowInstance, testRunStageId: string): string | undefined {
  const runIdx = instance.definition.stages.findIndex((s) => s.id === testRunStageId);
  if (runIdx < 0) {
    return undefined;
  }
  const implIdx = findLastImplStageIndex(instance.definition.stages, runIdx);
  if (implIdx < 0) {
    return undefined;
  }
  return instance.definition.stages[implIdx]?.id;
}

/** 切片测试文件：以 test_write 阶段的 writeOutputToFile 为准，回退约定路径。 */
function resolveTestFileForSlice(instance: WorkflowInstance, semantic: string): string {
  const tw = instance.definition.stages.find((s) => s.id === `stage_test_write_${semantic}`);
  const tc = tw?.toolConfig;
  if (tc && tc.type === 'llm-text' && tc.writeOutputToFile?.trim()) {
    return tc.writeOutputToFile.trim();
  }
  return `tests/test_${semantic}.py`;
}

export function shouldOfferRuntimeReplan(params: {
  trigger: RuntimeReplanTrigger;
  instance: WorkflowInstance;
}): boolean {
  const testRt = params.instance.stageRuntimes.find((rt) => rt.stageId === params.trigger.testRunStageId);
  const ledger = readReplanLedger(testRt?.outputs ?? {});
  return canSpendReplanBudget({
    ledger,
    sliceSemantic: params.trigger.sliceSemantic,
    budget: defaultRuntimeReplanBudget(),
  });
}

/**
 * 确定性运行时 replan 规划（纯函数；不调用 LLM）。
 * 返回 null 表示无可用规则或预算不足。
 */
export function planDeterministicReplan(params: {
  trigger: RuntimeReplanTrigger;
  instance: WorkflowInstance;
  /** gate-repair-exhausted / fix-exhausted 时 LLM 写目标 */
  gateRepairWriteTarget?: string;
}): RuntimeReplanAction | null {
  const { trigger, instance, gateRepairWriteTarget: writeTarget } = params;
  if (!shouldOfferRuntimeReplan({ trigger, instance })) {
    return null;
  }

  const { sliceSemantic, testRunStageId } = trigger;

  if (trigger.kind === 'preflight-pytest-asyncio') {
    const anchor = findAnchorForPip(trigger, instance);
    if (!anchor) {
      return null;
    }
    const stage = buildPipPytestAsyncioReplanStage({ semantic: sliceSemantic, anchorStageId: anchor });
    return {
      kind: 'insert-after',
      anchorStageId: anchor,
      stage,
      trigger,
      reason: 'preflight 缺少 pytest-asyncio',
    };
  }

  if (trigger.kind === 'preflight-conftest') {
    const anchor = findLastImplAnchor(instance, testRunStageId);
    if (!anchor) {
      const pip = findAnchorForPip(trigger, instance);
      if (!pip) {
        return null;
      }
      const stage = buildConftestReplanStage({ semantic: sliceSemantic, anchorStageId: pip });
      return {
        kind: 'insert-after',
        anchorStageId: pip,
        stage,
        trigger,
        reason: 'preflight 缺少 conftest.py',
      };
    }
    const stage = buildConftestReplanStage({ semantic: sliceSemantic, anchorStageId: anchor });
    return {
      kind: 'insert-after',
      anchorStageId: anchor,
      stage,
      trigger,
      reason: 'preflight 缺少 conftest.py',
    };
  }

  if (trigger.kind === 'fix-exhausted') {
    const anchor = findFixStageAnchor(instance, sliceSemantic);
    if (!anchor) {
      return null;
    }
    const implReplanId = `${RUNTIME_REPLAN_STAGE_ID_PREFIX}fix_${sliceSemantic}`;
    const testfixReplanId = `${RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX}${sliceSemantic}`;
    const postTestfixImplId = `${RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX}${sliceSemantic}`;
    const stages = instance.definition.stages;

    // 升级链第 3 级（T4 Run #29）：testfix 后仍红 → impl 按新测试对齐。
    if (stages.some((s) => s.id === testfixReplanId)) {
      if (stages.some((s) => s.id === postTestfixImplId) || !writeTarget) {
        return null;
      }
      const stage = buildPostTestfixImplReplanStage({
        semantic: sliceSemantic,
        anchorStageId: anchor,
        writeTarget,
        trigger,
      });
      return {
        kind: 'insert-after',
        anchorStageId: anchor,
        stage,
        trigger,
        reason: 'testfix 后 test_run 仍红 → impl 按新测试对齐',
      };
    }

    // 升级链第 2 级（T4 Run #23）：impl replan 已试过仍红 → 测试假红嫌疑。
    if (stages.some((s) => s.id === implReplanId)) {
      const stage = buildTestRewriteReplanStage({
        semantic: sliceSemantic,
        anchorStageId: anchor,
        writeTarget: resolveTestFileForSlice(instance, sliceSemantic),
        trigger,
      });
      return {
        kind: 'insert-after',
        anchorStageId: anchor,
        stage,
        trigger,
        reason: 'impl replan 后 test_run 仍红 → 重写假红嫌疑测试',
      };
    }

    // 升级链第 1 级：fix 链耗尽 → impl replan。
    if (!writeTarget) {
      return null;
    }
    const stage = buildFixExhaustedReplanStage({
      semantic: sliceSemantic,
      anchorStageId: anchor,
      writeTarget,
      trigger,
    });
    return {
      kind: 'insert-after',
      anchorStageId: anchor,
      stage,
      trigger,
      reason: `fix_if_failed 达上限仍失败`,
    };
  }

  if (trigger.kind === 'gate-repair-exhausted') {
    const anchor = findLastImplAnchor(instance, testRunStageId);
    if (!anchor || !writeTarget) {
      return null;
    }
    if (
      trigger.gateId !== GATE_ID_PYTHON_EXPORT_CONTRACT &&
      trigger.gateId !== GATE_ID_PYTHON_PYPI_SYMBOL
    ) {
      return null;
    }
    const stage = buildGateReplanLlmStage({
      semantic: sliceSemantic,
      anchorStageId: anchor,
      writeTarget,
      trigger,
    });
    return {
      kind: 'insert-after',
      anchorStageId: anchor,
      stage,
      trigger,
      reason: `gate-repair 后仍 block：${trigger.gateId}`,
    };
  }

  return null;
}
