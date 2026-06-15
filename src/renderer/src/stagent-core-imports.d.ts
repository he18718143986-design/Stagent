/** Vite 别名 `@stagent/friendly` / `@stagent/plan-summary` 的类型声明（实现由 electron.vite 解析到 core 源文件）。 */
declare module '@stagent/friendly/TranslationGlossary' {
  export function humanizeJargon(text: string): string
}

declare module '@stagent/friendly/toPlainLanguage' {
  export function plainTaskTypeLabel(taskType: string | undefined): string
  export function plainProvenanceLabel(provenance: string): string
  export function plainDecisionKindLabel(kind: string): string
  export function plainToolLabel(tool: string): string
  export function plainDecisionBoardSummary(params: {
    stageTitle: string
    kind: string
    provenance: string
    proposal?: string
  }): string
}

declare module '@stagent/plan-summary' {
  export interface PlanSummary {
    stageCount: number
    stageHardCap: number
    stageBudgetPercent: number
    decisionStageCount: number
    implStageCount: number
    testRunStageCount: number
    estimatedImplModules?: number
    dependencyEdgeCount: number
    complexityTier?: string
    exceedsStageLimit: boolean
    nearStageLimit: boolean
    missingGlobalArchDecision: boolean
    implMissingDecisionSourceCount: number
    rule20ViolationCount: number
    rule20WarningCount: number
  }

  export function formatPlanSummaryLines(summary: PlanSummary): string[]
}
