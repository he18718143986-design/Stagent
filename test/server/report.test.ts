/**
 * 验收 #12：交付报告（HTML / PDF 降级），只来自账本投影。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Ledger } from '../../src/ledger/index.js';
import { StagentService } from '../../src/server/service.js';
import { buildServer } from '../../src/server/http.js';
import { nodeConfig } from '../helpers/project.js';
import { FAIL, PASS, serverProject } from '../helpers/server.js';

describe('#12 交付报告', () => {
  it('每个功能有例子原文与最近一次系统验证时间；头部有版本四元组；授权记录（merge 免填原因、强行合并原因）；未验证项', async () => {
    const p = await serverProject();
    const a = await p.lock('登录', '.stagent/checks/a.mjs', PASS);
    await p.runAll();
    await p.call('POST', `/api/changes/${a.changeId}/merge`);
    const b = await p.lock('支付', '.stagent/checks/b.mjs', FAIL);
    await p.runAll();
    await p.call('POST', '/api/auth', { action: 'merge_override', changeId: b.changeId, reason: '先上线再修支付' });

    const res = await p.app.inject({ method: 'GET', url: '/api/report?format=html' });
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toMatch(/Stagent \d+\.\d+\.\d+ · 项目版本 .+ · 已验证 commit [0-9a-f]{12} · 生成于/);
    expect(html).toContain('登录 正常');
    expect(html).toContain('已验证（1 个例子）');
    expect(html).toContain('免填原因');
    expect(html).toContain('先上线再修支付');
    expect(html).toContain('已启用外部锚点');
    expect(html).toMatch(/未验证项[\s\S]*支付/);
    expect(html).toContain('豁免先失败检查');
  });

  it('PDF：环境没有 Chromium 时降级为 HTML 并注明原因', async () => {
    const p = await serverProject();
    const res = await p.app.inject({ method: 'GET', url: '/api/report?format=pdf' });
    if (res.headers['content-type'] === 'application/pdf') {
      expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    } else {
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toMatch(/降级为 HTML/);
      expect(decodeURIComponent(String(res.headers['x-stagent-report-note']))).toMatch(/降级/);
    }
  });

  it('integrity_override 显式标注为「用户接受了无法证明完整性的状态」，不写成"恢复"', async () => {
    const p = await serverProject();
    await p.lock('登录', '.stagent/checks/a.mjs', PASS);
    await p.service.dispose();
    const path = Ledger.pathFor(p.root);
    const lines = (await readFile(path, 'utf8')).split('\n');
    const i = lines.findIndex((l) => l.includes('"name":"登录"'));
    lines[i] = lines[i]!.replace('"name":"登录"', '"name":"登陆"');
    await writeFile(path, lines.join('\n'));
    const ledger = await Ledger.open(p.root);
    expect(ledger.state).toBe('locked');
    await ledger.acceptCurrentState('我手动改了功能名的错别字');
    const svc = await StagentService.open(p.root, { config: nodeConfig(), agent: null, docsDebounceMs: 0 });
    const app = await buildServer(svc, { serveWeb: false });
    const html = (await app.inject({ method: 'GET', url: '/api/report' })).body;
    expect(html).toContain('用户接受了无法证明完整性的状态');
    expect(html).toContain('我手动改了功能名的错别字');
    await app.close();
    await svc.dispose();
  });
});
