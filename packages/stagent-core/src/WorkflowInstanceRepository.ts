/**
 * M41：实例仓库层 — 从 WorkflowEngine 抽出实例 CRUD、磁盘扫描与 globalState 同步。
 * 引擎仍持有活跃实例指针与 HITL 编排；本模块聚焦可单测的持久化 I/O。
 *
 * 1.3：实现按 read / mutate / disk-roots 内聚边界拆分到 `instance-repo/*`，
 * 本文件仅做再导出以保持对外公开 API 不变。
 */

export type { InstanceRepositoryContext } from './instance-repo/context';
export {
  instanceTaskDirHint,
  getDefaultTaskDir,
  resolveInitialTaskDirForStart,
} from './instance-repo/context';

export { purgeInstanceGlobalState } from './instance-repo/purge';

export {
  collectInstanceDiskRoots,
  listKnownInstanceKeys,
} from './instance-repo/diskRoots';

export {
  readInstanceFile,
  isInstanceDiskStatePresent,
  loadInstanceByKey,
  loadInstanceByKeyForList,
  resolveInstanceForList,
} from './instance-repo/read';

export type { DeleteInstanceResult } from './instance-repo/mutate';
export {
  pruneStaleGlobalInstances,
  deleteInstanceRecord,
  resolveReuseInstance,
} from './instance-repo/mutate';
