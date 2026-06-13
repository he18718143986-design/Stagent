import { STAGENT_DIR } from '../paths/StagentPaths';

export const DEFAULT_WORKSPACE_SKIP_DIR_NAMES = new Set([
  STAGENT_DIR,
  'node_modules',
  '.git',
  'dist',
  'out',
  '__pycache__',
  '.venv',
  'venv',
]);
