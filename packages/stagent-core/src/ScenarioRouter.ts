/* ------------------------------------------------------------------ */
/*  ScenarioRouter — 场景（taskType × 仓库状态）→ workflowTemplate +      */
/*  有序 skill 序列（纯函数）。                                          */
/*                                                                     */
/*  对齐：WORKFLOW.md §4 路径选型、STAGENT-PRD §4.5、                   */
/*  SKILLS-ENGINE-INTEGRATION.md §4 路由表。                            */
/*  复用引擎现有 meta.taskType（software/prototype/document/debug/       */
/*  refactor/improve-architecture/other）。                            */
/* ------------------------------------------------------------------ */

/** 规范 skill 引用名（= skills 目录名）。 */
export const SKILL_SETUP = 'setup-matt-pocock-skills';
export const SKILL_GRILL_WITH_DOCS = 'grill-with-docs';
export const SKILL_GRILL_ME = 'grill-me';
export const SKILL_PROTOTYPE = 'prototype';
export const SKILL_TO_PRD = 'to-prd';
export const SKILL_TO_ISSUES = 'to-issues';
export const SKILL_TDD = 'tdd';
export const SKILL_TRIAGE = 'triage';
export const SKILL_DIAGNOSE = 'diagnose';
export const SKILL_ZOOM_OUT = 'zoom-out';
export const SKILL_IMPROVE_ARCH = 'improve-codebase-architecture';

export type WorkflowTemplate =
  | 'greenfield_full'
  | 'brownfield_full'
  | 'express'
  | 'debug'
  | 'arch_review';

export type EstimatedScope = 'single_slice' | 'multi_slice' | 'unknown';

export interface RepoSnapshot {
  /** 无 substantial 代码 / 无 CONTEXT → 绿场 */
  isGreenfield: boolean;
  hasContextMd?: boolean;
  hasAdrs?: boolean;
  /** 将改动陌生现有模块（触发 zoom-out 门禁） */
  touchesUnknownModule?: boolean;
  /** 项目级 setup 是否完成 */
  setupComplete?: boolean;
}

export interface ScenarioInput {
  /** 引擎 meta.taskType */
  taskType: string;
  estimatedScope?: EstimatedScope;
  repo: RepoSnapshot;
}

export interface ScenarioRoute {
  template: WorkflowTemplate;
  /** 有序 skill 序列（skillRef）；含按需项已展开为线性序列 */
  skillSequence: string[];
  /** 命中的规则与理由（可读，写入 meta / 展示给用户） */
  reason: string;
}

const TASK_DEBUG = 'debug';
const TASK_REFACTOR = 'refactor';
const TASK_IMPROVE_ARCH = 'improve-architecture';
const TASK_PROTOTYPE = 'prototype';

function greenfieldFull(includePrototype: boolean): string[] {
  const seq = [SKILL_SETUP, SKILL_GRILL_WITH_DOCS];
  if (includePrototype) {
    seq.push(SKILL_PROTOTYPE);
  }
  seq.push(SKILL_TO_PRD, SKILL_TO_ISSUES, SKILL_TDD);
  return seq;
}

function brownfieldFull(touchesUnknownModule: boolean): string[] {
  const seq = [SKILL_GRILL_WITH_DOCS, SKILL_TO_PRD, SKILL_TO_ISSUES];
  // Brownfield 动陌生模块 → zoom-out 门禁（WORKFLOW §14.4）
  if (touchesUnknownModule) {
    seq.push(SKILL_ZOOM_OUT);
  }
  seq.push(SKILL_TDD);
  return seq;
}

/**
 * 路由规则（优先级从高到低，对齐 STAGENT-PRD §4.5 / WORKFLOW §4）：
 *  1. debug                          → debug
 *  2. refactor / improve-architecture→ arch_review
 *  3. greenfield && multi_slice      → greenfield_full
 *  4. !greenfield && single_slice && !unknownModule → express
 *  5. 其余                            → brownfield_full（保守：对齐现有代码）
 *  prototype taskType：在主模板上插入 prototype skill。
 */
export function routeScenario(input: ScenarioInput): ScenarioRoute {
  const { taskType, repo } = input;
  const scope: EstimatedScope = input.estimatedScope ?? 'unknown';
  const isPrototype = taskType === TASK_PROTOTYPE;

  // 1. bug
  if (taskType === TASK_DEBUG) {
    return {
      template: 'debug',
      skillSequence: [SKILL_TRIAGE, SKILL_DIAGNOSE, SKILL_TDD],
      reason: 'taskType=debug → 走 bug 入口（triage → diagnose → tdd 回归）',
    };
  }

  // 2. 纯重构 / 架构治理
  if (taskType === TASK_REFACTOR || taskType === TASK_IMPROVE_ARCH) {
    return {
      template: 'arch_review',
      skillSequence: [SKILL_IMPROVE_ARCH],
      reason: `taskType=${taskType} → 架构治理（improve-codebase-architecture）`,
    };
  }

  // 3. 绿场 + 多切片
  if (repo.isGreenfield && scope !== 'single_slice') {
    return {
      template: 'greenfield_full',
      skillSequence: greenfieldFull(isPrototype),
      reason: '绿场且非单切片 → Greenfield 全量',
    };
  }

  // 4. 非绿场 + 单切片 + 不动陌生模块 → Express
  if (!repo.isGreenfield && scope === 'single_slice' && !repo.touchesUnknownModule) {
    const seq = [SKILL_GRILL_ME];
    if (isPrototype) {
      seq.push(SKILL_PROTOTYPE);
    }
    seq.push(SKILL_TDD);
    return {
      template: 'express',
      skillSequence: seq,
      reason: '非绿场、单切片、不动陌生模块 → Express（grill-me → tdd）',
    };
  }

  // 5. 默认 → Brownfield 全量（含 zoom-out 门禁）
  if (repo.isGreenfield) {
    // 绿场但 single_slice：仍走绿场全量（保证 setup+对齐）
    return {
      template: 'greenfield_full',
      skillSequence: greenfieldFull(isPrototype),
      reason: '绿场（单切片）→ Greenfield 全量（保证 setup 与对齐）',
    };
  }
  const seq = brownfieldFull(repo.touchesUnknownModule === true);
  if (isPrototype) {
    seq.splice(1, 0, SKILL_PROTOTYPE);
  }
  return {
    template: 'brownfield_full',
    skillSequence: seq,
    reason: repo.touchesUnknownModule
      ? '非绿场、跨模块/动陌生模块 → Brownfield 全量（含 zoom-out 门禁）'
      : '非绿场、范围不确定 → Brownfield 全量（保守对齐现有代码）',
  };
}
