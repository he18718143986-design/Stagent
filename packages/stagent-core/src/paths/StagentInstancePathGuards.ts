import { INSTANCES_SUBDIR, STAGENT_DIR } from './StagentPaths';

/** 路径是否位于 `…/.stagent/instances/…` 或 `…/instances/…`（用于安全删除实例状态目录）。 */
export function isStagentInstanceStateDir(dirPath: string): boolean {
  const re = new RegExp(
    `[\\\\/]${STAGENT_DIR.replace('.', '\\.')}[\\\\/]${INSTANCES_SUBDIR}[\\\\/]|[\\\\/]${INSTANCES_SUBDIR}[\\\\/]`,
  );
  return re.test(dirPath);
}
