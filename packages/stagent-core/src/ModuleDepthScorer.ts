import type { QualityScore } from './OutputQualityScorer';
import { CONFIDENCE_LEVEL_MEDIUM_MIN } from './ConfidenceBands';

/**
 * M25：深模块评分（借鉴 skills `improve-codebase-architecture` / Ousterhout「深模块」）。
 *
 * 深模块 = 简单接口 + 强大实现（接口面小、实现体量大，隐藏复杂度）；
 * 浅模块 = 接口面 ≈ 实现体量（薄包装、徒增认知成本）。
 *
 * 纯函数：统计「公共接口符号数」与「实现行数」，给出深度比与分类，并可换算质量分惩罚。
 * 默认仅告警；`stagent.architecture.depthScoring` 开启后接入质量分。
 */

export type ModuleDepthClass = 'deep' | 'moderate' | 'shallow';

export interface ModuleDepthMetrics {
  publicSymbolCount: number;
  implementationLines: number;
}

export interface ModuleDepthResult {
  ratio: number;
  classification: ModuleDepthClass;
  /** 0–1，越深越高 */
  score: number;
}

/** 至少要有这么多实现行才有资格评深度（太小的模块不评，避免噪声）。 */
export const MIN_IMPL_LINES_FOR_DEPTH = 12;
const SHALLOW_RATIO = 4; // 实现/接口 < 4 视为浅（接口面相对实现过大）
const DEEP_RATIO = 10; // ≥ 10 视为深

export function classifyDepthRatio(ratio: number): ModuleDepthClass {
  if (ratio >= DEEP_RATIO) {
    return 'deep';
  }
  if (ratio >= SHALLOW_RATIO) {
    return 'moderate';
  }
  return 'shallow';
}

export function scoreModuleDepth(metrics: ModuleDepthMetrics): ModuleDepthResult {
  const impl = Math.max(0, metrics.implementationLines);
  const iface = Math.max(1, metrics.publicSymbolCount);
  if (impl < MIN_IMPL_LINES_FOR_DEPTH) {
    // 体量过小，不判浅，给中性分
    return { ratio: impl / iface, classification: 'moderate', score: 0.6 };
  }
  const ratio = impl / iface;
  const classification = classifyDepthRatio(ratio);
  const score = classification === 'deep' ? 1 : classification === 'moderate' ? 0.6 : 0.3;
  return { ratio, classification, score };
}

/** 浅模块的质量分惩罚（0–1，越浅惩罚越大）；非浅返回 0。 */
export function moduleDepthPenalty(result: ModuleDepthResult): number {
  return result.classification === 'shallow' ? 0.3 : 0;
}

const PY_PUBLIC_DEF = /^(?:def|class)\s+(?!_)[A-Za-z]/;
const PY_PRIVATE_DEF = /^(?:def|class)\s+_/;

/** 粗粒度分析 Python 模块：顶层公共 def/class 计入接口；非空非注释非纯 import 行计入实现。 */
export function analyzePythonModuleDepth(content: string): ModuleDepthResult {
  const lines = content.split(/\r?\n/);
  let publicSymbols = 0;
  let implLines = 0;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    // 顶层（无缩进）的公共 def/class 计接口
    if (!/^\s/.test(line)) {
      if (PY_PUBLIC_DEF.test(trimmed)) {
        publicSymbols += 1;
      } else if (PY_PRIVATE_DEF.test(trimmed)) {
        // 私有定义不计接口，但其实现照常计入下方
      }
    }
    if (/^(?:import|from)\s/.test(trimmed)) {
      continue;
    }
    implLines += 1;
  }
  return scoreModuleDepth({ publicSymbolCount: publicSymbols, implementationLines: implLines });
}

/** 浅模块告警行（warning-only，前缀与 contract:* 风格一致，便于显示层归类）。 */
export function formatModuleDepthWarning(filePath: string, result: ModuleDepthResult): string | undefined {
  if (result.classification !== 'shallow') {
    return undefined;
  }
  return `architecture:shallow-module:${filePath} 接口面相对实现过大（深度比 ${result.ratio.toFixed(1)}），疑似薄包装，建议合并或下沉复杂度`;
}

/** M34：`stagent.architecture.depthScoring` 开启时，对 impl 产出降 quality.overall。 */
export function applyModuleDepthPenaltyToQualityScore(
  quality: QualityScore,
  pythonSource: string,
): QualityScore {
  const result = analyzePythonModuleDepth(pythonSource);
  const penalty = moduleDepthPenalty(result);
  if (penalty <= 0) {
    return quality;
  }
  const overall = Math.max(0, Math.round((quality.overall - penalty) * 1000) / 1000);
  let recommendation = quality.recommendation;
  if (overall < CONFIDENCE_LEVEL_MEDIUM_MIN && recommendation === 'approve') {
    recommendation = 'review';
  } else if (overall < 0.5 && recommendation !== 'retry') {
    recommendation = 'review';
  }
  const shallowMsg = formatModuleDepthWarning('impl-output', result);
  return {
    ...quality,
    overall,
    recommendation,
    issues: shallowMsg
      ? [
          ...quality.issues,
          { severity: 'warning' as const, code: 'architecture:shallow-module', message: shallowMsg },
        ]
      : quality.issues,
  };
}
