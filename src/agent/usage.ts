/**
 * 费用记录与上限（规格 §6「费用上限」）。
 *
 * 用量以 Agent SDK 返回的 usage 为准，写入 ~/.stagent/projects/<projectId>/usage.jsonl（内部数据，不进事件链）。
 * 上限：config.budget.perChange / perDay；budget_raise 授权（auth.granted.amount）在其上追加额度——
 * 带 changeId 的提高本改动的上限，同一天的授权都会提高当日上限。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StagentConfig } from '../config/config.js';
import { projectHomeDir } from '../home/home.js';
import type { LedgerLine } from '../ledger/types.js';
import type { AgentUsage } from './types.js';

export interface UsageRecord extends AgentUsage {
  at: string;
  changeId: string | null;
  task: string;
}

export interface BudgetStatus {
  todayCost: number;
  changeCost: number;
  perDay: number | null;
  perChange: number | null;
  /** 达到上限（任一）。 */
  exceeded: null | { scope: 'perChange' | 'perDay'; limit: number; spent: number };
}

export class UsageStore {
  constructor(private readonly projectId: string) {}

  get path(): string {
    return join(projectHomeDir(this.projectId), 'usage.jsonl');
  }

  async record(r: UsageRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(r) + '\n');
  }

  async all(): Promise<UsageRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as UsageRecord];
        } catch {
          return [];
        }
      });
  }

  async status(config: StagentConfig, lines: readonly LedgerLine[], changeId: string | null, now = new Date()): Promise<BudgetStatus> {
    const records = await this.all();
    const today = localDay(now);
    const todayCost = sum(records.filter((r) => localDay(new Date(r.at)) === today));
    const changeCost = changeId ? sum(records.filter((r) => r.changeId === changeId)) : 0;
    let raiseChange = 0;
    let raiseDay = 0;
    for (const { event: e, at } of lines) {
      if (e.type !== 'auth.granted' || e.action !== 'budget_raise' || !e.amount) continue;
      if (changeId && e.changeId === changeId) raiseChange += e.amount;
      if (localDay(new Date(at)) === today) raiseDay += e.amount;
    }
    const perChange = config.budget.perChange === null ? null : config.budget.perChange + raiseChange;
    const perDay = config.budget.perDay === null ? null : config.budget.perDay + raiseDay;
    const exceeded =
      perChange !== null && changeId && changeCost >= perChange
        ? { scope: 'perChange' as const, limit: perChange, spent: changeCost }
        : perDay !== null && todayCost >= perDay
          ? { scope: 'perDay' as const, limit: perDay, spent: todayCost }
          : null;
    return { todayCost, changeCost, perDay, perChange, exceeded };
  }
}

/** 剩余额度（给 SDK 的 maxBudgetUsd）；没有上限时为 undefined。 */
export function remainingBudget(s: BudgetStatus): number | undefined {
  const left = [s.perChange !== null ? s.perChange - s.changeCost : null, s.perDay !== null ? s.perDay - s.todayCost : null].filter(
    (x): x is number => x !== null,
  );
  return left.length ? Math.max(0, Math.min(...left)) : undefined;
}

function sum(rs: UsageRecord[]): number {
  return Math.round(rs.reduce((s, r) => s + (r.estimatedCost || 0), 0) * 10000) / 10000;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
