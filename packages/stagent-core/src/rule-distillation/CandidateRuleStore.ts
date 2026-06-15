import * as fs from 'fs';
import * as path from 'path';
import type { CandidateRule } from './CandidateRuleTypes';

export const CANDIDATE_RULES_FILENAME = 'candidate-rules.jsonl';

export function resolveCandidateRuleStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.stagent', CANDIDATE_RULES_FILENAME);
}

function readJsonlFile(storePath: string): CandidateRule[] {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const raw = fs.readFileSync(storePath, 'utf-8');
  const entries: CandidateRule[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed) as CandidateRule);
    } catch {
      // 跳过损坏行，保留其余条目
    }
  }
  return entries;
}

function writeJsonlFile(storePath: string, entries: CandidateRule[]): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const body = entries.length > 0 ? `${entries.map((e) => JSON.stringify(e)).join('\n')}\n` : '';
  fs.writeFileSync(storePath, body, 'utf-8');
}

/**
 * 候选规则 JSONL 持久化（镜像 WorkflowExperienceStore 风格）。
 * storePath 由调用方注入，本模块不读取宿主 workspace。
 */
export class CandidateRuleStore {
  constructor(private readonly storePath: string) {}

  readAll(): CandidateRule[] {
    return readJsonlFile(this.storePath);
  }

  writeAll(rules: CandidateRule[]): void {
    writeJsonlFile(this.storePath, rules);
  }

  /** 以 id 为键 upsert：用传入项覆盖同 id 旧项，新增项追加；返回合并后全量列表。 */
  upsert(rules: CandidateRule[]): CandidateRule[] {
    const byId = new Map<string, CandidateRule>();
    for (const rule of this.readAll()) {
      byId.set(rule.id, rule);
    }
    for (const rule of rules) {
      byId.set(rule.id, rule);
    }
    const merged = [...byId.values()];
    this.writeAll(merged);
    return merged;
  }
}
