/**
 * 本地 HTTP + SSE 接口（规格 §12）。业务流程在 src/server/flows/，这里只做路由。
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { LedgerVersionError } from '../ledger/verify.js';
import { registerGuardRoutes } from './guard-routes.js';
import { HttpError, type StagentService } from './service.js';
import * as agentFlow from './flows/agent-flow.js';
import * as examplesFlow from './flows/examples-flow.js';
import * as mapFlow from './flows/map-flow.js';
import * as planFlow from './flows/plan-flow.js';
import * as recordsFlow from './flows/records-flow.js';
import { report } from './flows/report-flow.js';
import { recordMetric } from '../metrics/metrics.js';
import { RUNS_RELATIVE_DIR } from '../executor/executor.js';

/** 打包后的前端（vite build 输出）。src/server 与 dist/server 都在包根目录下两级。 */
export const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export interface BuildServerOptions {
  /** 是否托管前端静态资源（测试里关闭）。 */
  serveWeb?: boolean;
  /** SSE 心跳间隔。 */
  heartbeatMs?: number;
}

const registeredRoutes = new WeakMap<FastifyInstance, { method: string; url: string }[]>();

/** 已注册的全部路由（Invariant 2 的测试据此枚举所有写接口）。 */
export function routesOf(app: FastifyInstance): { method: string; url: string }[] {
  return [...(registeredRoutes.get(app) ?? [])];
}

export async function buildServer(service: StagentService, opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  // 关闭时强制断开 SSE 长连接，否则浏览器开着页面时 Ctrl+C 会一直等。
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const routes: { method: string; url: string }[] = [];
  registeredRoutes.set(app, routes);
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) routes.push({ method, url: r.url });
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof LedgerVersionError) return reply.status(500).send({ error: err.message });
    const status = err.statusCode;
    if (status && status < 500) return reply.status(status).send({ error: err.message });
    return reply.status(500).send({ error: `服务内部错误：${err.message}` });
  });

  app.get('/api/overview', () => service.overview());
  app.get('/api/features', () => service.features());
  app.get<{ Params: { id: string } }>('/api/features/:id', (req) => service.feature(req.params.id));

  app.post('/api/runs', async (_req, reply) => reply.status(202).send(await service.startRegression()));
  app.post('/api/runs/current/cancel', async (_req, reply) => {
    service.cancelRun();
    return reply.status(202).send({ ok: true });
  });

  app.post<{ Body: { reason?: unknown } }>('/api/ledger/accept', async (req) => {
    await service.acceptLedger(typeof req.body?.reason === 'string' ? req.body.reason : '');
    return { ok: true };
  });
  // 账本恢复（§4.1、M6）：accept_current → integrity_override；establish_trust → TOFU；from_git → 从 git 历史恢复。
  app.post<{ Body: { mode?: unknown; reason?: unknown } }>('/api/ledger/recover', async (req) => {
    await service.recoverLedger(req.body?.mode, typeof req.body?.reason === 'string' ? req.body.reason : '');
    return { ok: true };
  });

  registerGuardRoutes(app, service);

  // 改动（§5）
  app.get('/api/changes', () => service.changes());
  // 建改动：AI 判断档位；需求应拆成计划时返回 { suggestPlan: true }，前端询问后调 /api/plans 或带 force: true 重试。
  app.post<{ Body: { description?: unknown; track?: unknown; force?: unknown } }>('/api/changes', async (req, reply) => {
    const r = await agentFlow.createChangeFlow(service, { description: req.body?.description, track: req.body?.track, force: req.body?.force });
    if (r.kind === 'suggest_plan') return reply.status(200).send({ suggestPlan: true, rationale: r.rationale, targetFeatureIds: r.targetFeatureIds });
    return reply.status(201).send(r.change);
  });
  app.get<{ Params: { id: string } }>('/api/changes/:id', (req) => service.change(req.params.id));
  app.post<{ Params: { id: string }; Body: { track?: unknown; reason?: unknown } }>('/api/changes/:id/track', (req) =>
    service.setTrack(req.params.id, req.body ?? {}),
  );
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/changes/:id/examples', async (req, reply) =>
    reply.status(201).send(await service.draftExample(req.params.id, req.body ?? {})),
  );
  app.post<{ Params: { id: string }; Body: { exampleIds?: unknown; acknowledgedExampleIds?: unknown } }>(
    '/api/changes/:id/examples/lock',
    (req) => service.lockExamples(req.params.id, req.body ?? {}),
  );
  app.post<{ Params: { id: string }; Body: { exampleIds?: unknown } }>('/api/changes/:id/examples/acknowledge', (req) =>
    service.acknowledgeDrafts(req.params.id, req.body ?? {}),
  );
  app.post<{ Params: { id: string } }>('/api/changes/:id/check', async (req, reply) =>
    reply.status(202).send(await service.startCheck(req.params.id)),
  );

  // Claude Code 驱动（§5、§8）
  app.post<{ Params: { id: string } }>('/api/changes/:id/draft', async (req, reply) =>
    reply.status(202).send(await examplesFlow.startDraftExamples(service, req.params.id)),
  );
  app.post<{ Params: { id: string } }>('/api/changes/:id/implement', async (req, reply) =>
    reply.status(202).send(await agentFlow.startAgentChain(service, req.params.id, 'implement')),
  );
  app.post<{ Params: { id: string } }>('/api/changes/:id/fix', async (req, reply) =>
    reply.status(202).send(await agentFlow.startAgentChain(service, req.params.id, 'fix')),
  );
  app.post<{ Params: { id: string } }>('/api/changes/:id/resume', async (req, reply) =>
    reply.status(202).send(await agentFlow.resumeAgent(service, req.params.id)),
  );
  app.post('/api/agent/cancel', async () => {
    agentFlow.cancelAgent(service);
    return { ok: true };
  });

  // 先失败检查（§5.1）
  app.post<{ Params: { id: string }; Body: { exampleIds?: unknown; acknowledgedExampleIds?: unknown } }>(
    '/api/changes/:id/red-check',
    (req) => examplesFlow.runRedCheck(service, req.params.id, req.body ?? {}),
  );
  app.post<{ Params: { id: string; exampleId: string }; Body: { reason?: unknown } }>('/api/changes/:id/examples/:exampleId/red-waive', (req) =>
    examplesFlow.redWaive(service, req.params.id, req.params.exampleId, req.body ?? {}),
  );
  app.post<{ Params: { id: string; exampleId: string } }>('/api/changes/:id/examples/:exampleId/rewrite', async (req, reply) =>
    reply.status(202).send(await examplesFlow.rewriteExample(service, req.params.id, req.params.exampleId)),
  );
  app.post<{ Params: { id: string; exampleId: string }; Body: { reason?: unknown } }>('/api/changes/:id/examples/:exampleId/discard', (req) =>
    examplesFlow.discardExample(service, req.params.id, req.params.exampleId, req.body ?? {}),
  );

  // 「改了什么」与文件归属（§4.5、D20）
  app.get<{ Params: { id: string } }>('/api/changes/:id/diff', (req) => mapFlow.changeDiff(service, req.params.id));
  app.put<{ Params: { id: string }; Body: unknown }>('/api/changes/:id/attributions', (req) => mapFlow.setAttributions(service, req.params.id, req.body));
  app.get('/api/map', () => mapFlow.mapView(service));
  app.get<{ Querystring: { path?: string } }>('/api/map/files', (req) => mapFlow.fileQuery(service, req.query.path ?? ''));
  app.post<{ Body: unknown }>('/api/map/files', (req) => mapFlow.reassignFile(service, req.body));

  // 需求计划（§5.5）
  app.get('/api/plans', () => planFlow.plans(service));
  app.post<{ Body: { requirement?: unknown } }>('/api/plans', async (req, reply) => reply.status(201).send(await planFlow.draftPlan(service, req.body ?? {})));
  app.get<{ Params: { id: string } }>('/api/plans/:id', (req) => planFlow.plan(service, req.params.id));
  app.post<{ Params: { id: string }; Body: { steps?: unknown } }>('/api/plans/:id/confirm', (req) => planFlow.confirmPlan(service, req.params.id, req.body ?? {}));
  app.post<{ Params: { id: string }; Body: { steps?: unknown; reason?: unknown } }>('/api/plans/:id/revise', (req) =>
    planFlow.revisePlan(service, req.params.id, req.body ?? {}),
  );
  app.post<{ Params: { id: string }; Body: { outcome?: unknown; reason?: unknown } }>('/api/plans/:id/close', (req) =>
    planFlow.closePlan(service, req.params.id, req.body ?? {}),
  );
  app.post<{ Params: { id: string; stepId: string } }>('/api/plans/:id/steps/:stepId/start', async (req, reply) =>
    reply.status(201).send(await planFlow.startStep(service, req.params.id, req.params.stepId)),
  );

  // 外观确认（§7）与决策卡追问（D17）
  app.post<{ Params: { exampleId: string }; Body: { ok?: unknown; note?: unknown } }>('/api/visual/:exampleId', (req) =>
    examplesFlow.confirmVisual(service, req.params.exampleId, req.body ?? {}),
  );
  app.post<{ Params: { cardId: string }; Body: unknown }>('/api/decisions/:cardId/ask', (req) => examplesFlow.askDecision(service, req.params.cardId, req.body));

  // 接入（§9）
  app.post('/api/scan', async (_req, reply) => reply.status(202).send(await examplesFlow.startScan(service)));
  app.get('/api/baseline', () => examplesFlow.listBaseline(service));
  app.post<{ Params: { id: string } }>('/api/features/:id/baseline', async (req, reply) =>
    reply.status(202).send(await examplesFlow.startBaselineDraft(service, req.params.id)),
  );
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/features/:id/baseline/manual', async (req, reply) =>
    reply.status(201).send(await examplesFlow.addBaselineDraft(service, req.params.id, req.body ?? {})),
  );
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/examples/:id/draft', (req) =>
    examplesFlow.editDraft(service, req.params.id, req.body ?? {}),
  );
  app.post<{ Body: { exampleIds?: unknown } }>('/api/baseline/lock', async (req, reply) =>
    reply.status(202).send(await examplesFlow.lockBaseline(service, req.body ?? {})),
  );
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/examples/:id/known-inconsistent', (req) =>
    examplesFlow.acceptKnownInconsistent(service, req.params.id, req.body ?? {}),
  );

  // 记录、规则与个人通用库（§10）
  app.get('/api/records', () => recordsFlow.recordsView(service));
  app.post<{ Body: Record<string, unknown> }>('/api/records', async (req, reply) => reply.status(201).send(await recordsFlow.saveRecord(service, req.body ?? {})));
  app.post<{ Params: { id: string } }>('/api/records/drafts/:id/dismiss', (req) => recordsFlow.dismissRecordDraft(service, req.params.id));
  app.get('/api/rules', async () => (await recordsFlow.recordsView(service)).rules);
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/rules/:id/accept', (req) => recordsFlow.acceptRule(service, req.params.id, req.body ?? {}));
  app.post<{ Params: { id: string } }>('/api/rules/:id/retire', (req) => recordsFlow.retireRule(service, req.params.id));
  app.post('/api/rules/regenerate', () => recordsFlow.regenerateRules(service));
  app.post('/api/rules/keep', () => recordsFlow.keepRulesDrift(service));
  app.get('/api/library', () => recordsFlow.libraryView(service));
  app.post<{ Params: { id: string } }>('/api/library/:id/import', (req) => recordsFlow.importLibraryRule(service, req.params.id));

  // 交付报告（§11、D26）
  app.get<{ Querystring: { format?: string } }>('/api/report', async (req, reply) => {
    const r = await report(service, req.query.format ?? 'html');
    if (r.note) reply.header('X-Stagent-Report-Note', encodeURIComponent(r.note));
    if (r.type === 'pdf') return reply.type('application/pdf').header('Content-Disposition', 'inline; filename="stagent-report.pdf"').send(r.body);
    return reply.type('text/html; charset=utf-8').send(r.body);
  });

  // 运行产物（截图、日志）：只允许 .stagent/runs/ 下的文件。
  app.get<{ Querystring: { path?: string } }>('/api/files', async (req, reply) => {
    const rel = normalize(req.query.path ?? '');
    const prefix = normalize(RUNS_RELATIVE_DIR) + sep;
    if (!rel.startsWith(prefix) || rel.includes(`..${sep}`)) throw new HttpError(400, '只能读取 .stagent/runs/ 下的运行产物');
    const body = await readFile(join(service.root, rel)).catch(() => null);
    if (body === null) throw new HttpError(404, '文件不存在');
    const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.log': 'text/plain; charset=utf-8' };
    return reply.type(types[extname(rel)] ?? 'text/plain; charset=utf-8').send(body);
  });

  // 开发服务器起不来时「修改启动命令」（§11）
  app.post<{ Body: { command?: unknown; url?: unknown } }>('/api/config/dev-server', (req) => service.setDevServer(req.body ?? {}));

  // 产品健康指标（§14）：只在本机，不进交付报告
  app.get('/api/health', () => service.health());

  // 界面埋点（§14）
  app.post<{ Body: { name?: unknown; data?: unknown } }>('/api/metrics', async (req) => {
    const name = typeof req.body?.name === 'string' && /^[a-z_.]{1,60}$/.test(req.body.name) ? req.body.name : null;
    // 只收数字与短字符串字段，防止界面把任意内容塞进埋点文件。
    const raw = typeof req.body?.data === 'object' && req.body.data ? (req.body.data as Record<string, unknown>) : {};
    const data = Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^[a-zA-Z]{1,30}$/.test(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 80))));
    if (name) await recordMetric(service.ledger.projectId, `ui.${name}`, data);
    return { ok: true };
  });

  // 授权与合并门（§6）：所有不可逆动作都走授权三段式。
  app.post<{ Params: { id: string } }>('/api/changes/:id/merge', (req) => service.merge(req.params.id));
  app.get<{ Params: { id: string } }>('/api/changes/:id/abandon-preview', (req) => service.abandonPreview(req.params.id));
  app.post<{ Body: Record<string, unknown> }>('/api/auth', (req) => service.authorize(req.body ?? {}));
  app.post<{ Params: { authId: string } }>('/api/auth/:authId/dismiss', async (req) => {
    await service.dismissDangling(req.params.authId);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/examples/:id/restore', async (req) => {
    await service.restoreLockedCheck(req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/examples/:id/relock', async (req) => {
    await service.relockExample(req.params.id, req.body ?? {});
    return { ok: true };
  });
  // §12 的专用授权入口：与 POST /api/auth 等价，走同一条三段式事务。
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/changes/:id/abandon', (req) =>
    service.authorize({ action: 'abandon', changeId: req.params.id, reason: req.body?.reason }),
  );
  app.post<{ Params: { id: string; exampleId: string }; Body: { reason?: unknown } }>('/api/changes/:id/examples/:exampleId/unlock', (req) =>
    service.authorize({ action: 'modify_locked', exampleId: req.params.exampleId, reason: req.body?.reason }),
  );
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/features/:id/retire', (req) =>
    service.authorize({ action: 'delete', featureId: req.params.id, reason: req.body?.reason }),
  );
  app.post<{ Body: { reason?: unknown } }>('/api/release', (req) => service.authorize({ action: 'release', reason: req.body?.reason }));

  app.get<{ Querystring: { lastEventId?: string } }>('/api/events/stream', (req, reply) => {
    const header = req.headers['last-event-id'];
    const lastId = Number((Array.isArray(header) ? header[0] : header) ?? req.query.lastEventId ?? NaN);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const send = (e: { id: number; type: string; data: unknown }) =>
      res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);

    if (Number.isFinite(lastId)) {
      const { events, gap } = service.bus.since(lastId);
      if (gap) res.write(`event: resync\ndata: {}\n\n`);
      events.forEach(send);
    }
    const unsubscribe = service.bus.subscribe(send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), opts.heartbeatMs ?? 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  if (opts.serveWeb !== false) {
    if (existsSync(WEB_DIST)) {
      await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith('/api/')) return reply.status(404).send({ error: '接口不存在' });
        return reply.sendFile('index.html');
      });
    } else {
      app.get('/', (_req, reply) =>
        reply
          .type('text/html; charset=utf-8')
          .send('<p>前端尚未构建：在 stagent 仓库运行 <code>npm run build</code>。接口可用：<a href="/api/overview">/api/overview</a></p>'),
      );
    }
  }

  return app;
}
