import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getManagedPromptSeeds } from './WorkflowPrompts';

export interface PromptVersion {
  id: string;
  hash: string;
  content: string;
  createdAt: string;
  tags: string[];
  successRate?: number;
  avgRetryCount?: number;
}

export interface PromptSlot {
  name: string;
  protected: boolean;
  currentVersion: PromptVersion;
  history: PromptVersion[];
}

export interface PromptVersionStore {
  version: 1;
  slots: Record<string, PromptSlot>;
}

const PROTECTED_SLOT_NAMES = new Set(['DECISION_RECORD_STRICT_SUFFIX', 'SPEC_75_ORIGINAL_TEXT']);

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

function newVersion(content: string, tags: string[] = []): PromptVersion {
  return {
    id: `pv_${crypto.randomUUID()}`,
    hash: hashContent(content),
    content,
    createdAt: new Date().toISOString(),
    tags,
  };
}

function buildInitialStore(): PromptVersionStore {
  const seeds = getManagedPromptSeeds();
  const slots: Record<string, PromptSlot> = {};
  for (const [name, seed] of Object.entries(seeds)) {
    const version = newVersion(seed.content, ['seed']);
    slots[name] = {
      name,
      protected: seed.protected,
      currentVersion: version,
      history: [version],
    };
  }
  return { version: 1, slots };
}

export class PromptVersionManager {
  private store: PromptVersionStore;

  constructor(private readonly storePath: string) {
    this.store = this.loadOrInit();
  }

  private loadOrInit(): PromptVersionStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as PromptVersionStore;
        if (parsed?.version === 1 && parsed.slots) {
          return parsed;
        }
      } catch {
        /* fall through */
      }
    }
    const initial = buildInitialStore();
    this.persist(initial);
    return initial;
  }

  private persist(next: PromptVersionStore = this.store): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(next, null, 2), 'utf-8');
    this.store = next;
  }

  getPrompt(slot: string): string {
    const s = this.store.slots[slot];
    if (!s) {
      const seeds = getManagedPromptSeeds();
      return seeds[slot]?.content ?? '';
    }
    return s.currentVersion.content;
  }

  setPrompt(slot: string, content: string, tags: string[] = [], options?: { allowProtected?: boolean }): void {
    const seeds = getManagedPromptSeeds();
    const isProtected = PROTECTED_SLOT_NAMES.has(slot) || seeds[slot]?.protected === true;
    if (isProtected && !options?.allowProtected) {
      const current = this.store.slots[slot]?.currentVersion.content ?? seeds[slot]?.content ?? '';
      if (hashContent(content) !== hashContent(current)) {
        throw new Error(`prompt-slot-protected:${slot}`);
      }
    }
    const version = newVersion(content, tags);
    const existing = this.store.slots[slot];
    const nextSlot: PromptSlot = existing
      ? {
          ...existing,
          currentVersion: version,
          history: [...existing.history, version].slice(-50),
        }
      : {
          name: slot,
          protected: isProtected,
          currentVersion: version,
          history: [version],
        };
    this.persist({
      ...this.store,
      slots: { ...this.store.slots, [slot]: nextSlot },
    });
  }

  rollback(slot: string, versionId: string): void {
    const s = this.store.slots[slot];
    if (!s) {
      throw new Error(`prompt-slot-missing:${slot}`);
    }
    const target = s.history.find((v) => v.id === versionId);
    if (!target) {
      throw new Error(`prompt-version-missing:${versionId}`);
    }
    this.persist({
      ...this.store,
      slots: {
        ...this.store.slots,
        [slot]: { ...s, currentVersion: target },
      },
    });
  }

  getSlot(slot: string): PromptSlot | undefined {
    return this.store.slots[slot];
  }

  isProtectedSlot(slot: string): boolean {
    return PROTECTED_SLOT_NAMES.has(slot) || this.store.slots[slot]?.protected === true;
  }

  exportForTesting(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, slot] of Object.entries(this.store.slots)) {
      out[name] = slot.currentVersion.content;
    }
    return out;
  }
}

export function resolveDefaultPromptVersionStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.stagent', 'prompt-versions.json');
}

/** M18.1：加载全部 managed 槽位当前版本，供 `buildWorkflowGeneratorPrompt` 消费。 */
export function loadManagedPromptSlots(storePath: string): Record<string, string> {
  const mgr = new PromptVersionManager(storePath);
  const seeds = getManagedPromptSeeds();
  const out: Record<string, string> = {};
  for (const name of Object.keys(seeds)) {
    out[name] = mgr.getPrompt(name);
  }
  return out;
}
