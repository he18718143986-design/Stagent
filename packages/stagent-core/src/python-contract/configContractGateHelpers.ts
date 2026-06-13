import * as fs from 'fs';
import * as path from 'path';
import type { GateResult, QualityGateContext } from '../QualityGate';
import { detectConfigContractIssues } from '../ConfigContractLint';
import { resolveArchitectureConfigYamlContent } from '../commitment/resolveArchitectureConfigYaml';
import { block } from '../quality-gates/gateHelpers';
import { GATE_ID_CONFIG_CONTRACT_POST_IMPL } from '../QualityGateIds';
import { isImplStage } from '../quality-gates/gateHelpers';
import { isFixIfFailedStageId } from '../runtime-replan/FixExhaustedRouter';
import { isPythonEntryScriptPath } from '../commitment/resolveArchitectureConfigYaml';

function resolveEntryScriptRelPath(ctx: QualityGateContext): string | undefined {
  const tc = ctx.stage?.toolConfig;
  if (tc && tc.type === 'llm-text' && tc.writeOutputToFile?.trim()) {
    return tc.writeOutputToFile.trim().replace(/\\/g, '/');
  }
  return undefined;
}

function readImplSource(ctx: QualityGateContext, relPath: string): string | undefined {
  const ws = ctx.taskWorkspaceAbs;
  if (!ws) {
    const out = ctx.stageRuntime?.outputs?.code ?? ctx.stageRuntime?.outputs?.fixPatch;
    if (typeof out === 'string' && out.trim()) {
      return out;
    }
    return undefined;
  }
  try {
    const abs = path.join(ws, relPath);
    return fs.readFileSync(abs, 'utf8');
  } catch {
    const out = ctx.stageRuntime?.outputs?.code ?? ctx.stageRuntime?.outputs?.fixPatch;
    return typeof out === 'string' ? out : undefined;
  }
}

/** post impl/fix：入口脚本 config 键须与架构 decisionArtifacts config.yaml 一致（T4 Run #33）。 */
export function evaluateConfigContractPostImplGate(ctx: QualityGateContext): GateResult | null {
  const stageId = ctx.stage?.id ?? '';
  if (!isImplStage(ctx.stage) && !isFixIfFailedStageId(stageId)) {
    return null;
  }
  const relPath = resolveEntryScriptRelPath(ctx);
  if (!isPythonEntryScriptPath(relPath)) {
    return null;
  }
  const yaml = resolveArchitectureConfigYamlContent(ctx.instance?.stageRuntimes ?? []);
  if (!yaml) {
    return null;
  }
  const scriptName = relPath!.split('/').pop() ?? relPath!;
  const scriptContent = readImplSource(ctx, relPath!);
  if (!scriptContent?.trim()) {
    return null;
  }
  const issues = detectConfigContractIssues({
    command: `python ${scriptName}`,
    configFiles: [{ name: 'config.yaml', content: yaml }],
    scripts: [{ name: scriptName, content: scriptContent }],
  });
  if (!issues.length) {
    return null;
  }
  return block(GATE_ID_CONFIG_CONTRACT_POST_IMPL, issues.map((i) => i.message), {
    issues,
  });
}
