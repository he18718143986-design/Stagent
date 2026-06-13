import type { Stage } from '../WorkflowDefinition';
import { generatedArtifactRelativePath } from '../paths/StagentPaths';
import { isImplStageId } from '../workflow/StageIdPatterns';
import { isLlmTextTool, STAGE_TOOL_FILE_WRITE } from '../workflow/StageToolKinds';
import { STAGENT_BUNDLE_WRITE_ID_SUFFIX } from './constants';

export function injectFileWriteAfterImplStages(stages: Stage[]): Stage[] {
  const out: Stage[] = [];
  for (const s of stages) {
    out.push(s);
    if (!isLlmTextTool(s.tool) || !isImplStageId(s.id)) {
      continue;
    }
    const bundleId = `${s.id}${STAGENT_BUNDLE_WRITE_ID_SUFFIX}`;
    if (stages.some((x) => x.id === bundleId) || out.some((x) => x.id === bundleId)) {
      continue;
    }
    const outKey = s.outputs[0]?.key ?? 'text';
    const w: Stage = {
      id: bundleId,
      title: `落盘：${s.title}`,
      description: '将上一实现阶段主输出写入工作区根下 .stagent/generated/，便于查看与 npm test 前人工核对。',
      tool: STAGE_TOOL_FILE_WRITE,
      dependsOn: [s.id],
      toolConfig: {
        type: STAGE_TOOL_FILE_WRITE,
        filePath: generatedArtifactRelativePath(s.id),
        sourceOutputKey: outKey,
        sourceStageId: s.id,
        pathBase: 'workspace',
      },
      input: {
        sources: [{ type: 'stage-output', stageId: s.id, outputKey: outKey, label: '实现输出' }],
        mergeStrategy: 'concat',
      },
      outputs: [{ key: 'writtenPath', format: 'file-path' }],
      pauseAfter: false,
    };
    out.push(w);
  }
  return out;
}
