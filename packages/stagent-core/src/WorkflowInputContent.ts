import type { InputSource, Stage } from './WorkflowDefinition';

/** 阶段主输出键：首个 output 的 key，缺省 `text`。 */
export function primaryOutputKey(stage: Stage): string {
  return stage.outputs[0]?.key ?? 'text';
}

/** 阶段输出值 → 文本：字符串原样，其余 JSON 序列化（null/undefined → 空串）。 */
export function stageOutputToText(out: unknown): string {
  return typeof out === 'string' ? out : JSON.stringify(out ?? '');
}

/** 粗略 token 估算（约 4 字符/token），与引擎其余处一致。 */
export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/** 超过 tokenLimit 时截断 stage-output 文本并追加提示；否则原样返回。 */
export function truncateStageOutputForInput(text: string, tokenLimit: number): string {
  if (estimateTokens(text) > tokenLimit) {
    return `${text.slice(0, tokenLimit * 4)}\n\n[内容已截断，完整内容见 taskDir]`;
  }
  return text;
}

/** 将引用源压缩为 `[reference]` 预览块（截断 200 字、空白折叠）。 */
export function toReferenceText(source: InputSource, raw: string): string {
  const preview = raw.slice(0, 200).replace(/\s+/g, ' ').trim();
  return `[reference]\nstageId=${source.stageId ?? ''}\noutputKey=${source.outputKey ?? ''}\npreview=${preview}`;
}
