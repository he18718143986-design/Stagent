import type { StageStatus } from '@stagent/core'

export type StageRole = 'decision' | 'impl' | 'test' | 'integration' | 'other'

export interface DagStageInput {
  id: string
  title: string
  isDecisionStage?: boolean
}

export interface DagNode {
  id: string
  title: string
  role: StageRole
  status: StageStatus
}

/** 由阶段 id / 是否决策阶段推断语义角色。纯函数。 */
export function stageRole(stageId: string, isDecision?: boolean): StageRole {
  if (isDecision) {
    return 'decision'
  }
  if (/^stage_impl_/.test(stageId)) {
    return 'impl'
  }
  if (/^stage_test_run_/.test(stageId)) {
    return 'test'
  }
  if (/integration|assemble|main/.test(stageId)) {
    return 'integration'
  }
  return 'other'
}

/** 由阶段列表 + 状态派生 MiniDag 节点。纯函数,便于单测。 */
export function deriveMiniDag(
  stages: DagStageInput[],
  stageStatus: Record<string, StageStatus>,
): DagNode[] {
  return stages.map((s) => ({
    id: s.id,
    title: s.title,
    role: stageRole(s.id, s.isDecisionStage),
    status: stageStatus[s.id] ?? 'pending',
  }))
}
