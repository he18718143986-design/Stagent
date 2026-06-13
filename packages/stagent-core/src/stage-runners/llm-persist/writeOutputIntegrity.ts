import {
  readWriteOutputIntegrityMode as readWriteOutputIntegrityModeSetting,
  type WriteOutputIntegrityMode,
} from '../../settings/readers/exec';

export type { WriteOutputIntegrityMode };
export {
  assessWriteOutputIntegrity,
  WriteOutputIntegrityMismatchError,
  WRITE_INTEGRITY_RETRY_SYSTEM_APPEND,
  WRITE_INTEGRITY_RETRY_USER_APPEND,
} from './writeOutputIntegrityAssess';

export function readWriteOutputIntegrityMode(
  cfg?: import('../../platform/HostTypes').WorkspaceConfiguration,
): WriteOutputIntegrityMode {
  return readWriteOutputIntegrityModeSetting(cfg);
}
