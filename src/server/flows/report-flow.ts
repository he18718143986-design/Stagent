/**
 * GET /api/report?format=html|pdf（规格 §11、§12）。PDF 环境不满足时降级为 HTML 并注明原因。
 */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../git/git.js';
import { projectPlans } from '../../plans/plans.js';
import { projectRecords } from '../../records/records.js';
import { buildReport, htmlToPdf, renderReportHtml, type ReportData } from '../../report/report.js';
import type { StagentService } from '../service.js';
import { liveMap } from './map-flow.js';

export async function reportData(svc: StagentService): Promise<ReportData> {
  const snap = await svc.state();
  return buildReport({
    projectName: basename(svc.root),
    stagentVersion: await stagentVersion(),
    projectVersion: await projectVersion(svc.root),
    generatedAt: new Date().toISOString(),
    lines: snap.lines,
    features: snap.projection.features,
    map: liveMap(snap.lines, snap.projection.features),
    plans: projectPlans(snap.lines, snap.changes.changes),
    records: projectRecords(snap.lines),
    anchor: svc.ledger.anchorStatus,
  });
}

export async function report(svc: StagentService, format: string): Promise<{ type: 'html' | 'pdf'; body: string | Buffer; note?: string }> {
  const data = await reportData(svc);
  if (format === 'pdf') {
    const { pdf, reason } = await htmlToPdf(renderReportHtml(data));
    if (pdf) return { type: 'pdf', body: pdf };
    return { type: 'html', body: renderReportHtml(data, { pdfNote: reason ?? 'PDF 导出不可用，已降级为 HTML' }), note: reason };
  }
  return { type: 'html', body: renderReportHtml(data) };
}

async function stagentVersion(): Promise<string> {
  try {
    const path = fileURLToPath(new URL('../../../package.json', import.meta.url));
    return (JSON.parse(await readFile(path, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

async function projectVersion(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // 不是 Node 项目
  }
  return (await git(root, ['describe', '--tags', '--always']).catch(() => '')).trim() || '—';
}
