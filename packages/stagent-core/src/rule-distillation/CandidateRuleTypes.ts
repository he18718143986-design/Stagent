/* ------------------------------------------------------------------ */
/*  失败→规则沉淀闭环（首切片）：候选规则类型                            */
/*                                                                     */
/*  本切片只做提炼 + 持久化 + 影子 warn，绝不接入任何硬门 / 生效路径。    */
/* ------------------------------------------------------------------ */

export type CandidateRuleStatus = 'needs_review' | 'active' | 'blocked';

export interface CandidateRule {
  /** 稳定派生自 patternId（sanitize 后） */
  id: string;
  /** 来源 ActionablePatternKind（自由字符串以避免对枚举的硬依赖） */
  kind: string;
  patternId: string;
  /** 人读规则文本（取 recommendation） */
  message: string;
  sourcePatternIds: string[];
  /** 未来 seam 咨询次数（telemetry，新建=0） */
  serves: number;
  /** 命中/频次（新建= pattern.frequency） */
  hits: number;
  /** 0..1（无人工反馈时=0） */
  acceptanceRate: number;
  status: CandidateRuleStatus;
  createdAt: string;
  updatedAt: string;
}
