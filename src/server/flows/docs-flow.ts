/**
 * 文档生成器（规格 §10）：每次相关事件之后重新生成 .stagent/docs/*.md（features / system-map / plan / rules）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderFeatures, renderPlan, renderRules, renderSystemMap } from '../../docs/docs.js';
import { projectPlans } from '../../plans/plans.js';
import { projectRecords } from '../../records/records.js';
import type { StagentService } from '../service.js';
import { mapView } from './map-flow.js';

export const DOCS_RELATIVE_DIR = join('.stagent', 'docs');

export async function writeDocs(svc: StagentService): Promise<string[]> {
  if (svc.ledger.state === 'locked') return [];
  const snap = await svc.state();
  const map = await mapView(svc);
  const files: Record<string, string> = {
    'features.md': renderFeatures(snap.projection.features),
    'system-map.md': renderSystemMap(map, snap.projection.features),
    'plan.md': renderPlan(projectPlans(snap.lines, snap.changes.changes)),
    'rules.md': renderRules(projectRecords(snap.lines)),
  };
  const dir = join(svc.root, DOCS_RELATIVE_DIR);
  await mkdir(dir, { recursive: true });
  // 生成的文档不进 git（§4.3）：目录自带 .gitignore，即使项目根目录的 .gitignore 没有这一条，合并时 git add -A 也不会收进去。
  await writeFile(join(dir, '.gitignore'), '*\n');
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return Object.keys(files).map((n) => `${DOCS_RELATIVE_DIR}/${n}`);
}
