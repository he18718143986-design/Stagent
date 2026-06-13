import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { buildWorkflowProcessDocs } from '../WorkflowProcessDocs';

export function writeWorkflowProcessDocs(
  wf: WorkflowDefinition,
  taskDir: string,
  expandUserHomePath: (raw: string) => string,
  warn: (message: string) => void,
): void {
  const wsRaw = wf.meta?.taskWorkspacePath?.trim();
  const targetDir = wsRaw ? expandUserHomePath(wsRaw) : taskDir;
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const doc of buildWorkflowProcessDocs(wf)) {
      fs.writeFileSync(path.join(targetDir, doc.fileName), doc.content, 'utf8');
    }
  } catch (e) {
    warn(`write_process_docs_failed err=${String(e)}`);
  }
}
