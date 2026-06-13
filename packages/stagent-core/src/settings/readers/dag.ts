import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { DEFAULT_DAG_MAX_PARALLELISM, resolveDagMaxParallelism } from '../../StagentSettingsDefaults';
import { readConfigResolved } from './readConfigHelpers';

/** vscode `stagent.dagMaxParallelism` */
export function readDagMaxParallelism(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'dagMaxParallelism',
    resolveDagMaxParallelism,
    DEFAULT_DAG_MAX_PARALLELISM,
  );
}
