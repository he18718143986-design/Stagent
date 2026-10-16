import { useEffect, useState } from 'react';
import type { RecordsResponse } from '../api';
import { api } from '../api';
import { relativeTime } from '../format';

type Act = (fn: () => Promise<unknown>) => Promise<void>;
const TAGS = ['联调', '接口', '数据', '部署', '环境', '测试', '依赖', '界面'];

/** 决策与规则（§10）：记录卡、记录列表、规则（含度量与退役提示）、个人通用库。 */
export function RulesPage({ act, refreshKey, onDeleteRecord }: { act: Act; refreshKey: string; onDeleteRecord: (recordId: string, title: string) => void }) {
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [lib, setLib] = useState<{ stack: string[]; items: { id: string; kind: string; title: string; body: string; tags: string[] }[] } | null>(null);
  const [form, setForm] = useState({ kind: 'pitfall', title: '', body: '', tag: '环境', library: false });
  useEffect(() => {
    void api.records().then(setData).catch(() => undefined);
    void api.library().then(setLib).catch(() => undefined);
  }, [refreshKey]);
  if (!data) return <div className="loading">正在读取记录…</div>;
  const rules = data.rules.filter((r) => r.status !== 'retired');
  return (
    <div className="rules-page">
      {data.drafts.length > 0 && (
        <section className="card">
          <h2 className="section-title">记录卡（AI 起草，等你保存）</h2>
          {data.drafts.map((d) => (
            <div key={d.draftId} className="record-card">
              <div>
                <span className="tag">{d.kind === 'decision' ? '决策' : '踩坑'}</span> <b>{d.title}</b> {d.tags.map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
              <p>{d.body}</p>
              <div className="row">
                <button className="btn btn-primary small" onClick={() => act(() => api.saveRecord({ draftId: d.draftId }))}>
                  保存
                </button>
                <button className="btn small" onClick={() => act(() => api.saveRecord({ draftId: d.draftId, library: true }))}>
                  保存并同步到个人通用库
                </button>
                <button className="btn btn-ghost small" onClick={() => act(() => api.dismissRecordDraft(d.draftId))}>
                  不记录
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2 className="section-title">规则</h2>
        {rules.length === 0 && <p className="muted">还没有规则。同一标签的踩坑记录达到 2 条时，会出现规则提案。</p>}
        {rules.map((r) => (
          <div key={r.ruleId} className="record-card">
            <div>
              <span className={`tag ${r.status === 'accepted' ? 'tag-已验收' : ''}`}>{r.status === 'accepted' ? '已生效' : '提案'}</span> <b>{r.text}</b>
            </div>
            <div className="muted small">
              适用：{r.appliesWhen} · 失效：{r.expiresWhen} · 标签：{r.tags.join('、')}
              {r.acceptedAt && ` · 生效后同类踩坑 ${r.pitfallsAfter} 次 · 已合并 ${r.changesSince} 个改动`}
            </div>
            {r.suggestRetire && <div className="banner banner-warn">生效后已有 {r.changesSince} 次改动、同类坑仍出现 {r.pitfallsAfter} 次：这条规则可能没起作用，考虑退役或改写。</div>}
            <div className="row">
              {r.status === 'proposed' && (
                <button className="btn btn-primary small" onClick={() => act(() => api.acceptRule(r.ruleId))}>
                  接受
                </button>
              )}
              <button className="btn btn-ghost small" onClick={() => act(() => api.retireRule(r.ruleId))}>
                {r.status === 'proposed' ? '不要' : '退役'}
              </button>
            </div>
          </div>
        ))}
        {data.drift.length > 0 && (
          <div className="banner banner-warn">
            规则区块已偏离账本：{data.drift.map((d) => d.file).join('、')}
            <button className="btn small" onClick={() => act(api.regenerateRules)}>
              以账本为准重新生成
            </button>
          </div>
        )}
        <p className="muted small">
          接受的规则写入 CLAUDE.md 与 .cursor/rules/stagent.mdc 中由 <code>{'<!-- stagent:rules -->'}</code> 包裹的区块。
        </p>
      </section>

      <section className="card">
        <h2 className="section-title">记一条</h2>
        <div className="grid">
          <label className="field">
            <span>类型</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="pitfall">踩坑</option>
              <option value="decision">决策</option>
            </select>
          </label>
          <label className="field">
            <span>标签</span>
            <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
              {TAGS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            <span>标题</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="field span-2">
            <span>内容</span>
            <input value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={form.library} onChange={(e) => setForm({ ...form, library: e.target.checked })} /> 同步到个人通用库
          </label>
          <div className="grid-actions">
            <button
              className="btn"
              disabled={!form.title.trim()}
              onClick={() => act(() => api.saveRecord({ kind: form.kind, title: form.title, body: form.body, tags: [form.tag], library: form.library }).then(() => setForm({ ...form, title: '', body: '' })))}
            >
              保存
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">记录</h2>
        {data.records.length === 0 ? (
          <p className="muted">还没有记录。</p>
        ) : (
          <ul className="records">
            {data.records.map((r) => (
              <li key={r.recordId}>
                <span className="tag">{r.kind === 'decision' ? '决策' : '踩坑'}</span> <b>{r.title || r.body.slice(0, 40)}</b> {r.tags.map((t) => <span key={t} className="tag">{t}</span>)}{' '}
                <span className="muted small">{relativeTime(r.at)}</span>
                {r.body && r.title && <div className="muted small">{r.body}</div>}
                <button className="linklike small" onClick={() => onDeleteRecord(r.recordId, r.title || r.body.slice(0, 20))}>
                  删除（需授权）
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">个人通用库{lib?.stack.length ? `（匹配技术栈：${lib.stack.join(' / ')}）` : ''}</h2>
        {!lib?.items.length ? (
          <p className="muted">通用库是空的。保存记录或接受规则时勾选「同步到个人通用库」，新项目接入时可以挑选。</p>
        ) : (
          <ul>
            {lib.items.map((x) => (
              <li key={x.id}>
                <span className="tag">{x.kind === 'rule' ? '规则' : x.kind === 'decision' ? '决策' : '踩坑'}</span> {x.title}{' '}
                <button className="btn btn-ghost small" onClick={() => act(() => api.importLibrary(x.id))}>
                  作为规则提案引入本项目
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
