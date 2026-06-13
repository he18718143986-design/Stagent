/** 从 stageId 提取前缀，供经验库失败模式匹配（与 FailurePatternAnalyzer 一致）。 */
export function stageIdPrefixForExperience(stageId: string): string {
  const m = stageId.match(/^(stage_(?:impl|decide|test_(?:run|write))_[^_]+)/);
  return m?.[1] ?? stageId.split('_').slice(0, 3).join('_');
}
