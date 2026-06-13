import type { Stage } from '../WorkflowDefinition';

/** 与生成侧注入一致；模型若自行加入同 id 则跳过重复注入 */
export const STAGE_INIT_NPM_WORKSPACE_ID = 'stage_init_npm_workspace';

/** 引擎在 software pipeline 为每个 stage_impl_* 自动插入的 file-write 落盘阶段 id 后缀 */
export const STAGENT_BUNDLE_WRITE_ID_SUFFIX = '_stagent_bundle_write';

export function isStagentBundleWriteStage(stage: Pick<Stage, 'id'>): boolean {
  return stage.id.endsWith(STAGENT_BUNDLE_WRITE_ID_SUFFIX);
}
