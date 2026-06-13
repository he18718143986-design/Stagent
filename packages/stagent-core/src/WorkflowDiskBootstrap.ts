/**
 * Re-export shim：disk-bootstrap 已模块化；保留本路径以兼容既有 import。
 */
export {
  STAGE_INIT_NPM_WORKSPACE_ID,
  STAGENT_BUNDLE_WRITE_ID_SUFFIX,
  isStagentBundleWriteStage,
  patchNpmDefaultTestScriptAfterInit,
  injectInitNpmWorkspaceStage,
  injectFileWriteAfterImplStages,
  augmentTestRunToWorkspaceRoot,
  injectDeliveryWrapupStage,
  collectDeliverableFilePaths,
  DELIVERY_WRAPUP_STAGE_ID,
  injectSmokeStage,
  looksLikeServeCommand,
  SMOKE_RUN_STAGE_ID,
  applySoftwareDiskPipeline,
} from './disk-bootstrap';
