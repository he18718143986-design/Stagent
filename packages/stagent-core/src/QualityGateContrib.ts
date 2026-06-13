/**
 * 第三方 / 扩展贡献 QualityGate 的公开 API。
 *
 * @example
 * ```ts
 * import { registerQualityGate } from 'stagent/quality-gates';
 * registerQualityGate({
 *   id: 'eslint-workspace',
 *   label: 'ESLint',
 *   phase: 'post-stage',
 *   priority: 200,
 *   tags: ['eslint'],
 *   enabled: (ctx) => ctx.stage?.tool === 'code-runner',
 *   async evaluate(ctx) {
 *     // run eslint, return warn/block
 *     return null;
 *   },
 * });
 * ```
 */
export {
  registerQualityGate,
  getDefaultQualityGateRegistry,
  resetDefaultQualityGateRegistry,
  flattenGateMessages,
  type QualityGate,
  type QualityGateContext,
  type QualityGateExecutionHost,
  type QualityGatePhase,
  type QualityGateWhen,
  type GateResult,
  type GateSeverity,
  type QualityGateRunSummary,
} from './QualityGate';

export { registerBuiltinQualityGates, listRegisteredQualityGateIds } from './BuiltinQualityGates';
