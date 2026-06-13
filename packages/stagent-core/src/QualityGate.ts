import type { Stage, StageRuntime, WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import type { QualityGateExecutionHost } from './quality-gate/QualityGateExecutionHost';
import type { VerifyResult } from './Rule20Verify';
import type { GenerationGateSettings } from './WorkflowGenerationOrchestrator';
import type { DependencyGraph } from './DependencyGraphAnalyzer';
import type { ComplexityEstimate } from './WorkflowComplexityEstimator';

/** 生成期 / 阶段前 / 阶段后 / 工作流结束。 */
export type QualityGatePhase = 'generate' | 'pre-stage' | 'post-stage' | 'workflow-end';

/**
 * 执行期子时机（同一 phase 内按 priority 排序后，再按 when 过滤调用点）。
 * - always：阶段入口（pre-stage 默认）
 * - before-impl：llm-text stage_impl_* 正文生成前
 * - before-test-run：code-runner stage_test_run_* 执行前
 */
export type QualityGateWhen = 'always' | 'before-impl' | 'before-test-run';

export type GateSeverity = 'block' | 'warn' | 'info';

export interface GateResult {
  gateId: string;
  severity: GateSeverity;
  messages: string[];
  meta?: Record<string, unknown>;
}

export interface QualityGateContext {
  phase: QualityGatePhase;
  when?: QualityGateWhen;
  workflow?: WorkflowDefinition;
  stage?: Stage;
  stageIndex?: number;
  stageRuntime?: StageRuntime;
  instance?: WorkflowInstance;
  instanceKey?: string;
  taskWorkspaceAbs?: string;
  effectiveTaskType?: string;
  userInput?: string;
  /** 生成期 Rule20 verify 结果（可复用避免重复 verify） */
  verifyResult?: VerifyResult;
  runtimeRule20On?: boolean;
  generationGates?: GenerationGateSettings;
  depGraph?: DependencyGraph;
  complexity?: ComplexityEstimate;
  maxStageWarn?: number;
  uiTaskType?: string;
  modelTaskType?: string;
  structuralRepairs?: unknown[];
  /** 执行期宿主能力（lint 读盘、runCodeRunner 等），由 WorkflowEngine 注入 */
  executionHost?: QualityGateExecutionHost;
  extras?: Record<string, unknown>;
}

export type { QualityGateExecutionHost } from './quality-gate/QualityGateExecutionHost';

export interface QualityGate {
  id: string;
  label: string;
  phase: QualityGatePhase;
  /** 数值越小越先执行 */
  priority: number;
  /** 执行期子时机；generate / workflow-end 忽略 */
  when?: QualityGateWhen;
  /**
   * 显式声明本门必须在哪些门「之后」运行（同 phase + 同 when 内）。
   * 此前门间顺序仅靠 priority 数字隐式表达（如 test-run-deps-install 必须先于
   * test-run-preflight）；声明 dependsOn 后可用 {@link QualityGateRegistry.validateDependencies}
   * 自检 priority 是否与依赖矛盾，避免重排 priority 时静默破坏顺序。
   */
  dependsOn?: string[];
  /** 第三方扩展：如 eslint / prettier */
  tags?: string[];
  enabled?: (ctx: QualityGateContext) => boolean;
  evaluate: (ctx: QualityGateContext) => Promise<GateResult | null> | GateResult | null;
}

/** 门依赖一致性问题（priority 与 dependsOn 矛盾 / 依赖缺失 / 跨 phase）。 */
export interface GateDependencyIssue {
  gateId: string;
  dependsOnId: string;
  kind: 'missing' | 'phase-mismatch' | 'when-mismatch' | 'priority-order';
  message: string;
}

export interface QualityGateRunOptions {
  when?: QualityGateWhen;
  /** 命中 block 后是否立即停止（默认 true） */
  stopOnBlock?: boolean;
  severities?: GateSeverity[];
}

export interface QualityGateRunSummary {
  results: GateResult[];
  blocks: GateResult[];
  warnings: GateResult[];
  infos: GateResult[];
}

export class QualityGateRegistry {
  private readonly gates = new Map<string, QualityGate>();

  register(gate: QualityGate): void {
    if (this.gates.has(gate.id)) {
      throw new Error(`QualityGate already registered: ${gate.id}`);
    }
    this.gates.set(gate.id, gate);
  }

  /** 覆盖注册（内置 gate 热替换 / 测试用） */
  registerOrReplace(gate: QualityGate): void {
    this.gates.set(gate.id, gate);
  }

  unregister(id: string): boolean {
    return this.gates.delete(id);
  }

  get(id: string): QualityGate | undefined {
    return this.gates.get(id);
  }

  list(phase?: QualityGatePhase): QualityGate[] {
    const all = [...this.gates.values()];
    const filtered = phase ? all.filter((g) => g.phase === phase) : all;
    return filtered.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  /**
   * 校验所有门的 dependsOn 与 priority/phase/when 一致：
   * 依赖必须存在、同 phase、when 兼容，且被依赖门 priority 严格小于本门
   * （否则执行顺序会与声明的依赖矛盾）。返回问题列表，供启动期/测试期 degraded。
   */
  validateDependencies(): GateDependencyIssue[] {
    const issues: GateDependencyIssue[] = [];
    for (const gate of this.gates.values()) {
      for (const depId of gate.dependsOn ?? []) {
        const dep = this.gates.get(depId);
        if (!dep) {
          issues.push({
            gateId: gate.id,
            dependsOnId: depId,
            kind: 'missing',
            message: `门 ${gate.id} 依赖不存在的门 ${depId}`,
          });
          continue;
        }
        if (dep.phase !== gate.phase) {
          issues.push({
            gateId: gate.id,
            dependsOnId: depId,
            kind: 'phase-mismatch',
            message: `门 ${gate.id}(${gate.phase}) 依赖跨 phase 门 ${depId}(${dep.phase})`,
          });
          continue;
        }
        // when 兼容性：依赖门 when 为 undefined（always 适用）或与本门一致才会同批运行。
        if (gate.when && dep.when && dep.when !== gate.when) {
          issues.push({
            gateId: gate.id,
            dependsOnId: depId,
            kind: 'when-mismatch',
            message: `门 ${gate.id}(when=${gate.when}) 依赖 when=${dep.when} 的门 ${depId}，二者不同批运行`,
          });
        }
        if (dep.priority >= gate.priority) {
          issues.push({
            gateId: gate.id,
            dependsOnId: depId,
            kind: 'priority-order',
            message: `门 ${gate.id}(priority=${gate.priority}) 依赖 ${depId}(priority=${dep.priority})，但后者 priority 未严格更小，执行顺序与依赖矛盾`,
          });
        }
      }
    }
    return issues;
  }

  async run(
    phase: QualityGatePhase,
    ctx: QualityGateContext,
    options: QualityGateRunOptions = {},
  ): Promise<QualityGateRunSummary> {
    const when = options.when;
    const stopOnBlock = options.stopOnBlock !== false;
    const allowedSeverities = options.severities ?? ['block', 'warn', 'info'];
    const results: GateResult[] = [];

    for (const gate of this.list(phase)) {
      if (when && gate.when && gate.when !== when) {
        continue;
      }
      if (gate.enabled && !gate.enabled({ ...ctx, phase, when })) {
        continue;
      }
      const raw = await gate.evaluate({ ...ctx, phase, when });
      if (!raw) {
        continue;
      }
      const result: GateResult = { ...raw, gateId: raw.gateId || gate.id };
      if (!allowedSeverities.includes(result.severity)) {
        continue;
      }
      results.push(result);
      if (stopOnBlock && result.severity === 'block') {
        break;
      }
    }

    return {
      results,
      blocks: results.filter((r) => r.severity === 'block'),
      warnings: results.filter((r) => r.severity === 'warn'),
      infos: results.filter((r) => r.severity === 'info'),
    };
  }
}

let defaultRegistry: QualityGateRegistry | undefined;

export function getDefaultQualityGateRegistry(): QualityGateRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new QualityGateRegistry();
  }
  return defaultRegistry;
}

/** 测试隔离：重置默认注册表 */
export function resetDefaultQualityGateRegistry(): void {
  defaultRegistry = undefined;
}

export function registerQualityGate(gate: QualityGate): void {
  getDefaultQualityGateRegistry().register(gate);
}

export function flattenGateMessages(summary: QualityGateRunSummary): string[] {
  return summary.results.flatMap((r) => r.messages);
}
