import { useEffect, useState } from 'react';
import type { BaselineDraft, FeatureView, OverviewResponse } from '../api';
import { api } from '../api';

type Act = (fn: () => Promise<unknown>) => Promise<void>;

/**
 * 接入（§9）：扫描发现的功能 → 勾选 3–5 个核心功能补基线例子 → 草稿可自由修改 → 确认后锁定并跑一次基线。
 */
export function Onboarding({ features, overview, act, refreshKey }: { features: FeatureView[]; overview: OverviewResponse; act: Act; refreshKey: string }) {
  const [drafts, setDrafts] = useState<BaselineDraft[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [then, setThen] = useState('');
  useEffect(() => {
    void api.baseline().then((r) => setDrafts(r.drafts)).catch(() => undefined);
  }, [refreshKey]);

  const scanned = features.filter((f) => f.origin === 'scan' && f.lockedCount === 0);
  const scan = overview.scan;
  if (!scanned.length && !drafts.length && !scan?.running) return null;
  const aiReady = overview.agent.availability.available && !overview.agent.task;
  const draftedFor = new Set(drafts.map((d) => d.featureId));

  return (
    <section className="card" aria-label="接入">
      <h2 className="section-title">接入现有项目</h2>
      {scan?.running && <p className="muted">正在扫描路由、页面和接口，已发现 {scan.found.length} 个功能：{scan.found.join('、')}</p>}
      {scan?.error && <div className="banner banner-error">扫描失败：{scan.error}</div>}
      {scanned.length > 0 && (
        <>
          <p className="muted">勾选 3–5 个核心功能，让 Claude Code 为它们起草基线例子（描述现在已有的行为）。其余功能先留着，之后随时「补例子」。</p>
          <ul className="check-list">
            {scanned.map((f) => (
              <li key={f.featureId}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(f.featureId)}
                    disabled={draftedFor.has(f.featureId)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(f.featureId);
                      else next.delete(f.featureId);
                      setChosen(next);
                    }}
                  />
                  {f.name} {draftedFor.has(f.featureId) && <span className="tag">已起草</span>}
                </label>
              </li>
            ))}
          </ul>
          <span className="action">
            <button
              className="btn btn-primary"
              disabled={!aiReady || chosen.size === 0}
              onClick={() =>
                act(async () => {
                  for (const id of chosen) {
                    await api.baselineDraft(id);
                    // 一次只能有一个 AI 任务：等这个起草完再起草下一个。
                    for (let i = 0; i < 600; i++) {
                      const o = await api.overview();
                      if (!o.agent.task) break;
                      await new Promise((r) => setTimeout(r, 1000));
                    }
                  }
                  setChosen(new Set());
                })
              }
            >
              为勾选的 {chosen.size} 个功能起草基线例子
            </button>
            {!aiReady && <span className="disabled-reason">{overview.agent.availability.reason ?? 'Claude Code 正忙'}</span>}
          </span>
        </>
      )}
      {drafts.length > 0 && (
        <>
          <h3 className="section-title">基线例子草稿（锁定前可以自由修改）</h3>
          <ul className="draft-list">
            {drafts.map((d) => (
              <li key={d.exampleId}>
                <span className="tag">{d.featureName}</span> 情况：{d.given} → 操作：{d.when} → 期望：
                {editing === d.exampleId ? (
                  <>
                    <input value={then} onChange={(e) => setThen(e.target.value)} />
                    <button
                      className="btn small"
                      onClick={() =>
                        act(async () => {
                          await api.editDraft(d.exampleId, { then });
                          setEditing(null);
                          setDrafts((await api.baseline()).drafts);
                        })
                      }
                    >
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <b>{d.then}</b>{' '}
                    <button
                      className="linklike small"
                      onClick={() => {
                        setEditing(d.exampleId);
                        setThen(d.then);
                      }}
                    >
                      修改
                    </button>
                  </>
                )}
                {d.summary && <div className="muted small">这条检查实际在看：{d.summary}</div>}
              </li>
            ))}
          </ul>
          <button className="btn btn-primary" onClick={() => act(() => api.lockBaseline(drafts.map((d) => d.exampleId)))}>
            确认并锁定 {drafts.length} 个基线例子，跑一次基线
          </button>
          <p className="muted small">基线例子描述已有行为，不做先失败检查。基线失败不会自动改代码：你可以改例子、新建改动去修，或接受现状（标「已知不一致」）。</p>
        </>
      )}
    </section>
  );
}
