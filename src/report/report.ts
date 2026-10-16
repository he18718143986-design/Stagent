/**
 * 外包交付报告（规格 §11「交付报告」、D26；tasks.md M5-2）。一页式 HTML，可另存为 PDF。
 *
 * 报告内容只来自账本投影："仅 AI 声称"的条目明确标出；普通 merge 的原因如实写「免填原因」；
 * ledger.integrity_override 显式标注为「用户接受了无法证明完整性的状态」，不表述为"恢复"。
 */
import type { MapProjection } from '../map/map.js';
import { filesOfFeature } from '../map/map.js';
import type { AnchorStatus } from '../ledger/ledger.js';
import type { AuthAction, IsoTime, LedgerLine } from '../ledger/types.js';
import type { PlansProjection } from '../plans/plans.js';
import { UNVERIFIED_LABELS, type ExampleView, type FeatureView } from '../projection/projection.js';
import type { RecordsProjection } from '../records/records.js';

export const AUTH_ACTION_LABELS: Record<AuthAction, string> = {
  merge: '合并',
  merge_override: '强行合并',
  abandon: '放弃改动',
  modify_locked: '修改锁定例子',
  delete: '删除（功能退役 / 记录删除）',
  release: '发布上线',
  budget_raise: '提高费用上限',
};

export interface ReportData {
  project: string;
  versions: { stagent: string; project: string; verifiedCommit: string | null; generatedAt: IsoTime };
  integrity: { level: string; events: { kind: string; at: IsoTime; text: string }[] };
  features: {
    name: string;
    stateLabel: string;
    tags: string[];
    files: string[];
    examples: { given: string; when: string; then: string; kind: string; result: string; lastRunAt: IsoTime | null; redCheck: string; claimOnly: boolean }[];
  }[];
  plans: { requirement: string; status: string; progress: string; steps: { title: string; status: string }[] }[];
  authorizations: { at: IsoTime; action: string; reason: string; outcome: string; subject: string }[];
  releases: { at: IsoTime; command: string; exitCode: number }[];
  unverified: { feature: string; then: string; reason: string }[];
  decisions: { at: IsoTime; title: string; body: string }[];
  claimsRefuted: { feature: string; then: string; claim: string }[];
}

export interface ReportInput {
  projectName: string;
  stagentVersion: string;
  projectVersion: string;
  generatedAt: IsoTime;
  lines: readonly LedgerLine[];
  features: readonly FeatureView[];
  map: MapProjection;
  plans: PlansProjection;
  records: RecordsProjection;
  anchor: AnchorStatus;
}

export function buildReport(input: ReportInput): ReportData {
  const { lines, features } = input;
  let verifiedCommit: string | null = null;
  const settled = new Map<string, { ok: boolean; detail?: string }>();
  const integrityEvents: ReportData['integrity']['events'] = [];
  const releases: ReportData['releases'] = [];
  for (const { event: e, at } of lines) {
    if (e.type === 'run.completed' && e.valid && e.purpose !== 'red_check') verifiedCommit = e.endCommit;
    else if (e.type === 'auth.settled') settled.set(e.authId, { ok: e.ok, ...(e.detail ? { detail: e.detail } : {}) });
    else if (e.type === 'ledger.integrity_override') {
      integrityEvents.push({ kind: '用户接受了无法证明完整性的状态', at, text: `${e.reason}（被接受的断链行：${e.brokenLinks.join('、') || '无，外部锚点冲突'}）` });
    } else if (e.type === 'ledger.trust_established') integrityEvents.push({ kind: '首次信任确认（TOFU）', at, text: e.detail });
    else if (e.type === 'ledger.restored') integrityEvents.push({ kind: '从 git 历史恢复', at, text: `${e.detail}（提交 ${e.fromCommit.slice(0, 7)}，丢弃 ${e.discardedLines} 行）` });
    else if (e.type === 'ledger.head_recovered') integrityEvents.push({ kind: '崩溃恢复（自动）', at, text: e.detail });
    else if (e.type === 'release.executed') releases.push({ at, command: e.command, exitCode: e.exitCode });
  }

  const authorizations: ReportData['authorizations'] = [];
  for (const { event: e, at } of lines) {
    if (e.type !== 'auth.granted') continue;
    const s = settled.get(e.authId);
    authorizations.push({
      at,
      action: AUTH_ACTION_LABELS[e.action],
      reason: e.action === 'merge' && !e.reason ? '免填原因' : e.reason || '（未填写）',
      outcome: !s ? '未结算（悬挂）' : s.ok ? '成功' : `失败${s.detail ? `：${s.detail}` : ''}`,
      subject: e.changeId ?? e.targetId ?? '',
    });
  }

  const resultText = (x: ExampleView): string => {
    if (x.state === 'verified') return '通过';
    if (x.state === 'failed') return x.knownInconsistent ? '失败（已知不一致）' : '失败';
    return `未验证 · ${UNVERIFIED_LABELS[x.reason ?? 'not_run']}`;
  };
  const redText = (x: ExampleView): string =>
    x.redCheck.kind === 'failed'
      ? `先失败检查合格（run ${x.redCheck.runId.slice(-6)}）`
      : x.redCheck.kind === 'waived'
        ? `豁免先失败检查：${x.redCheck.reason}`
        : x.redCheck.kind === 'baseline'
          ? '基线例子（描述已有行为，不做先失败检查）'
          : '锁定时未记录先失败检查';

  const unverified: ReportData['unverified'] = [];
  const claimsRefuted: ReportData['claimsRefuted'] = [];
  for (const f of features) {
    for (const x of f.examples) {
      if (x.state !== 'verified') unverified.push({ feature: f.name, then: x.then, reason: x.knownInconsistent ? '已知不一致' : x.state === 'failed' ? '失败' : UNVERIFIED_LABELS[x.reason ?? 'not_run'] });
      if (x.claims.length && x.state !== 'verified') claimsRefuted.push({ feature: f.name, then: x.then, claim: x.claims.at(-1)!.text.slice(0, 200) });
    }
  }

  return {
    project: input.projectName,
    versions: { stagent: input.stagentVersion, project: input.projectVersion, verifiedCommit, generatedAt: input.generatedAt },
    integrity: {
      level: input.anchor.enabled ? `已启用外部锚点（${input.anchor.headPath ?? '~/.stagent/projects/<id>/head'}）：链内一致性 + 仓库外链头` : '仅校验链内一致性（未启用外部锚点）',
      events: integrityEvents,
    },
    features: features.map((f) => ({
      name: f.name,
      stateLabel: f.stateLabel,
      tags: f.tags,
      files: filesOfFeature(input.map, f.featureId).slice(0, 6).map((x) => x.path),
      examples: f.examples.map((x) => ({
        given: x.given,
        when: x.when,
        then: x.then,
        kind: x.kind === 'visual' ? '外观' : '行为',
        result: resultText(x),
        lastRunAt: x.lastResult?.at ?? null,
        redCheck: redText(x),
        claimOnly: x.reason === 'ai_claim_only',
      })),
    })),
    plans: input.plans.plans
      .filter((p) => p.status !== 'draft')
      .map((p) => ({
        requirement: p.requirement,
        status: p.statusLabel,
        progress: `${p.progress.done}/${p.progress.total}`,
        steps: p.steps.map((s) => ({ title: s.title, status: s.statusLabel })),
      })),
    authorizations,
    releases,
    unverified,
    decisions: input.records.records
      .filter((r) => r.kind === 'decision' && !r.tags.includes('授权'))
      .map((r) => ({ at: r.at, title: r.title, body: r.body })),
    claimsRefuted,
  };
}

export function renderReportHtml(d: ReportData, opts: { pdfNote?: string } = {}): string {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');
  const verified = d.features.filter((f) => f.stateLabel.startsWith('已验证')).length;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(d.project)} · 交付报告</title>
<style>
body{font:13px/1.55 -apple-system,'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#1c2330;max-width:900px;margin:24px auto;padding:0 24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #e3e6ea;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #e3e6ea;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f6f7f9;font-weight:600}
.muted{color:#6b7380}.ok{color:#15803d}.bad{color:#b91c1c}.warn{color:#b45309}.tag{display:inline-block;border:1px solid #e3e6ea;border-radius:4px;padding:0 5px;margin-right:4px;font-size:11px}
.claim{background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:1px 5px;font-size:11px}.note{background:#eff6ff;padding:8px 10px;border-radius:6px}
@media print{body{margin:0}}
</style></head><body>
<h1>${esc(d.project)} · 交付报告</h1>
<p class="muted">Stagent ${esc(d.versions.stagent)} · 项目版本 ${esc(d.versions.project)} · 已验证 commit ${esc(d.versions.verifiedCommit?.slice(0, 12) ?? '（尚无有效运行）')} · 生成于 ${esc(fmt(d.versions.generatedAt))}</p>
${opts.pdfNote ? `<p class="note">${esc(opts.pdfNote)}</p>` : ''}
<p>共 ${d.features.length} 个功能，其中 ${verified} 个「已验证」。「已验证（N 个例子）」只表示在已锁定例子范围内成立；报告内容只来自账本，AI 的回报只算声称。</p>

<h2>账本完整性</h2>
<p>${esc(d.integrity.level)}</p>
${d.integrity.events.length ? `<table><tr><th>时间</th><th>事件</th><th>说明</th></tr>${d.integrity.events.map((e) => `<tr><td>${esc(fmt(e.at))}</td><td><b>${esc(e.kind)}</b></td><td>${esc(e.text)}</td></tr>`).join('')}</table>` : '<p class="muted">没有完整性相关的人工处理记录。</p>'}

<h2>功能清单</h2>
${d.features
  .map(
    (f) => `<h3 style="font-size:14px;margin:14px 0 4px">${esc(f.name)} <span class="${f.stateLabel.startsWith('已验证') ? 'ok' : f.stateLabel.startsWith('被破坏') ? 'bad' : 'warn'}">${esc(f.stateLabel)}</span> ${f.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</h3>
${f.files.length ? `<div class="muted">主要文件：${f.files.map(esc).join('、')}</div>` : ''}
${f.examples.length ? `<table><tr><th>例子（情况 → 操作 → 期望）</th><th>最近一次系统验证</th><th>先失败检查</th></tr>${f.examples
      .map(
        (x) => `<tr><td>${esc(x.given)} → ${esc(x.when)} → <b>${esc(x.then)}</b> <span class="muted">（${esc(x.kind)}）</span>${x.claimOnly ? ' <span class="claim">仅 AI 声称</span>' : ''}</td><td>${esc(x.result)}<br><span class="muted">${esc(fmt(x.lastRunAt))}</span></td><td>${esc(x.redCheck)}</td></tr>`,
      )
      .join('')}</table>` : '<p class="muted">尚无锁定例子。</p>'}`,
  )
  .join('\n')}

<h2>需求计划</h2>
${d.plans.length ? d.plans.map((p) => `<p><b>${esc(p.requirement)}</b> · ${esc(p.status)} · ${esc(p.progress)}<br>${p.steps.map((s, i) => `${i + 1}. ${esc(s.title)}（${esc(s.status)}）`).join('<br>')}</p>`).join('') : '<p class="muted">没有需求计划。</p>'}

<h2>授权放行记录</h2>
${d.authorizations.length ? `<table><tr><th>时间</th><th>动作</th><th>原因</th><th>结果</th></tr>${d.authorizations.map((a) => `<tr><td>${esc(fmt(a.at))}</td><td>${esc(a.action)}</td><td>${esc(a.reason)}</td><td>${esc(a.outcome)}</td></tr>`).join('')}</table>` : '<p class="muted">没有授权记录。</p>'}
${d.releases.length ? `<p>发布：${d.releases.map((r) => `${esc(fmt(r.at))} <code>${esc(r.command)}</code> 退出码 ${r.exitCode}${r.exitCode ? ' <span class="bad">（失败，未自动回滚）</span>' : ''}`).join('<br>')}</p>` : ''}

<h2>未验证项</h2>
${d.unverified.length ? `<table><tr><th>功能</th><th>例子</th><th>原因</th></tr>${d.unverified.map((u) => `<tr><td>${esc(u.feature)}</td><td>${esc(u.then)}</td><td>${esc(u.reason)}</td></tr>`).join('')}</table>` : '<p class="ok">所有锁定例子都在当前代码上验证通过。</p>'}
${d.claimsRefuted.length ? `<p><b>AI 声称完成但系统未验证通过：</b><br>${d.claimsRefuted.map((c) => `「${esc(c.feature)}」${esc(c.then)} <span class="claim">仅 AI 声称</span>`).join('<br>')}</p>` : ''}

<h2>关键技术方案</h2>
${d.decisions.length ? d.decisions.map((r) => `<p><b>${esc(r.title || '决策')}</b>：${esc(r.body)}</p>`).join('') : '<p class="muted">没有记录的技术决策。</p>'}
</body></html>
`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * HTML → PDF：用 Playwright 的 page.pdf()（不新增依赖：项目里装了 playwright 才可用）。
 * 运行环境没有 Chromium 时返回 null 与原因，调用方降级为仅 HTML 并在报告中注明。
 */
export async function htmlToPdf(html: string): Promise<{ pdf: Buffer | null; reason?: string }> {
  const moduleName = 'playwright';
  let playwright: { chromium: { launch: () => Promise<{ newPage: () => Promise<{ setContent: (h: string) => Promise<void>; pdf: (o: object) => Promise<Buffer> }>; close: () => Promise<void> }> } };
  try {
    playwright = (await import(moduleName)) as typeof playwright;
  } catch {
    return { pdf: null, reason: '运行环境没有安装 Playwright（无 Chromium），PDF 导出降级为 HTML' };
  }
  try {
    const browser = await playwright.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      return { pdf: await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } }) };
    } finally {
      await browser.close();
    }
  } catch (err) {
    return { pdf: null, reason: `Chromium 无法启动（${(err as Error).message.split('\n')[0]}），PDF 导出降级为 HTML` };
  }
}
