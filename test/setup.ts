/**
 * 全部测试共用：每个测试一个独立的 ~/.stagent（STAGENT_HOME），避免链头锚点、费用记录、个人通用库在测试之间串味；
 * 默认关闭真实的 Claude Code（STAGENT_AGENT=off），需要 AI 的测试显式注入 ScriptedExecutor。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

process.env.STAGENT_AGENT = 'off';
let home: string | null = null;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'stagent-home-'));
  process.env.STAGENT_HOME = home;
});

afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = null;
});
