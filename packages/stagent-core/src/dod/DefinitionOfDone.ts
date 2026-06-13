import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_DOD_RELATIVE_PATH = '.stagent/dod.json';

export type DodDeliverableCheck = {
  path: string;
  kind: 'file_exists';
};

export type DefinitionOfDone = {
  deliverables?: DodDeliverableCheck[];
  verification?: {
    smokeRequired?: boolean;
  };
};

export type DodEvaluation = {
  configured: boolean;
  deliverablesTotal: number;
  deliverablesSatisfied: number;
  missingDeliverables: string[];
  smokeRequired: boolean;
  reasons: string[];
};

export function parseDefinitionOfDone(raw: unknown): DefinitionOfDone | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const deliverables = Array.isArray(o.deliverables)
    ? o.deliverables
        .filter((d): d is DodDeliverableCheck => {
          return (
            !!d &&
            typeof d === 'object' &&
            typeof (d as DodDeliverableCheck).path === 'string' &&
            (d as DodDeliverableCheck).kind === 'file_exists'
          );
        })
        .map((d) => ({ path: d.path.trim(), kind: 'file_exists' as const }))
        .filter((d) => d.path.length > 0)
    : undefined;
  const verification =
    o.verification && typeof o.verification === 'object' && !Array.isArray(o.verification)
      ? {
          smokeRequired: (o.verification as { smokeRequired?: boolean }).smokeRequired === true,
        }
      : undefined;
  return { deliverables, verification };
}

export function readDefinitionOfDoneFromWorkspace(workspaceRoot: string): DefinitionOfDone | null {
  const abs = path.join(workspaceRoot, DEFAULT_DOD_RELATIVE_PATH);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown;
    return parseDefinitionOfDone(parsed);
  } catch {
    return null;
  }
}

export function evaluateDefinitionOfDone(params: {
  workspaceRoot?: string;
  smokeStageDone?: boolean;
}): DodEvaluation {
  const { workspaceRoot, smokeStageDone } = params;
  const reasons: string[] = [];
  if (!workspaceRoot) {
    return {
      configured: false,
      deliverablesTotal: 0,
      deliverablesSatisfied: 0,
      missingDeliverables: [],
      smokeRequired: false,
      reasons: ['无工作区根目录，跳过 DoD'],
    };
  }

  const dod = readDefinitionOfDoneFromWorkspace(workspaceRoot);
  if (!dod) {
    return {
      configured: false,
      deliverablesTotal: 0,
      deliverablesSatisfied: 0,
      missingDeliverables: [],
      smokeRequired: false,
      reasons: [],
    };
  }

  const deliverables = dod.deliverables ?? [];
  const missingDeliverables: string[] = [];
  let satisfied = 0;
  for (const d of deliverables) {
    const abs = path.join(workspaceRoot, d.path);
    if (d.kind === 'file_exists' && fs.existsSync(abs)) {
      satisfied += 1;
    } else {
      missingDeliverables.push(d.path);
    }
  }
  if (missingDeliverables.length > 0) {
    reasons.push(`DoD 交付物缺失：${missingDeliverables.join(', ')}`);
  }

  const smokeRequired = dod.verification?.smokeRequired === true;
  if (smokeRequired && !smokeStageDone) {
    reasons.push('DoD 要求 stage_smoke_run 通过，但未完成');
  }

  return {
    configured: true,
    deliverablesTotal: deliverables.length,
    deliverablesSatisfied: satisfied,
    missingDeliverables,
    smokeRequired,
    reasons,
  };
}
