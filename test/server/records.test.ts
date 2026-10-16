/**
 * 验收 #11：记录卡、规则提案、规则区块与偏离提示；个人通用库。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedExecutor } from '../../src/agent/scripted.js';
import { RULES_BLOCK_START } from '../../src/records/records.js';
import type { RecordsResponse } from '../../src/server/flows/records-flow.js';
import type { OverviewResponse } from '../../src/server/service.js';
import { StagentService } from '../../src/server/service.js';
import { nodeConfig } from '../helpers/project.js';
import { waitAgent } from '../helpers/agent.js';
import { PASS, serverProject } from '../helpers/server.js';

describe('#11 记录与规则', () => {
  it('合并后 AI 起草记录卡；同标签踩坑达到 2 条出规则提案；确认后写入 CLAUDE.md 与 .cursor/rules；手改区块后启动提示偏离', async () => {
    const agent = new ScriptedExecutor({
      draftRecords: () => [{ kind: 'pitfall', title: '本地端口被占用', body: '开发服务器起不来', tags: ['环境'] }],
      draftRule: (i) => ({ text: `启动前先检查端口（${i.pitfalls.length} 次踩坑）`, appliesWhen: '运行开发服务器时', expiresWhen: '改用随机端口后' }),
    });
    const p = await serverProject(undefined, { agent, autoAgent: false });
    const a = await p.lock('登录', '.stagent/checks/a.mjs', PASS);
    await p.runAll();
    await p.call('POST', `/api/changes/${a.changeId}/merge`);
    await waitAgent(p.service);
    let rec = (await p.call<RecordsResponse>('GET', '/api/records')).body;
    expect(rec.drafts).toHaveLength(1);
    expect((await p.call<OverviewResponse>('GET', '/api/overview')).body.recordDraftCount).toBe(1);

    // 保存记录卡（第 1 条「环境」踩坑），再手写第 2 条 → 出现规则提案。
    await p.call('POST', '/api/records', { draftId: rec.drafts[0]!.draftId });
    expect((await p.call<RecordsResponse>('GET', '/api/records')).body.rules).toHaveLength(0);
    await p.call('POST', '/api/records', { kind: 'pitfall', title: 'CI 上端口冲突', body: '又是端口', tags: ['环境'] });
    rec = (await p.call<RecordsResponse>('GET', '/api/records')).body;
    expect(rec.rules).toHaveLength(1);
    expect(rec.rules[0]).toMatchObject({ status: 'proposed', text: '启动前先检查端口（2 次踩坑）', tags: ['环境'] });
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.ruleProposals.map((r) => r.ruleId)).toEqual([rec.rules[0]!.ruleId]);

    expect((await p.call('POST', `/api/rules/${rec.rules[0]!.ruleId}/accept`, { library: true })).status).toBe(200);
    const claude = await readFile(join(p.root, 'CLAUDE.md'), 'utf8');
    const cursor = await readFile(join(p.root, '.cursor/rules/stagent.mdc'), 'utf8');
    for (const text of [claude, cursor]) {
      expect(text).toContain(RULES_BLOCK_START);
      expect(text).toContain('启动前先检查端口（2 次踩坑）（适用：运行开发服务器时；失效：改用随机端口后）');
    }
    // 个人通用库
    const lib = (await p.call<{ items: { id: string; kind: string }[] }>('GET', '/api/library')).body.items;
    expect(lib.map((x) => x.kind)).toEqual(['rule']);

    // 手动篡改区块 → 下次启动（新服务实例）出现偏离提示。
    await writeFile(join(p.root, 'CLAUDE.md'), claude.replace('启动前先检查端口', '随便写写'));
    const svc = await StagentService.open(p.root, { config: nodeConfig(), agent: null, docsDebounceMs: 0 });
    const drift = (await svc.overview()).rulesDrift;
    expect(drift).toEqual([{ file: 'CLAUDE.md', problem: 'modified', fingerprint: expect.any(String) }]);
    await svc.dispose();
    // 以账本为准重新生成
    expect((await p.call('POST', '/api/rules/regenerate')).status).toBe(200);
    expect((await p.call<OverviewResponse>('GET', '/api/overview')).body.rulesDrift).toEqual([]);
    expect(await readFile(join(p.root, 'CLAUDE.md'), 'utf8')).toContain('启动前先检查端口');
  });

  it('删除记录需要 delete 授权（targetId = recordId）；保留现状不再提示', async () => {
    const p = await serverProject();
    const { recordId } = (await p.call<{ recordId: string }>('POST', '/api/records', { kind: 'decision', title: '用 SQLite', body: '单机足够', tags: ['数据'] })).body;
    expect((await p.call('POST', '/api/auth', { action: 'delete', recordId, reason: '记录写错了' })).status).toBe(200);
    expect((await p.call<RecordsResponse>('GET', '/api/records')).body.records.some((r) => r.recordId === recordId)).toBe(false);
  });
});
