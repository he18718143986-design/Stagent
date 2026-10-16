import { Fragment, useEffect, useState } from 'react';
import type { ChangeView, FeatureView } from '../api';
import { api } from '../api';
import { relativeTime } from '../format';
import { DiffView } from '../components/DiffView';

/** 改动记录：每个改动的档位、来源、阶段与「改了什么」。 */
export function ChangesPage({ features, refreshKey, onError }: { features: FeatureView[]; refreshKey: string; onError: (m: string) => void }) {
  const [changes, setChanges] = useState<ChangeView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void api
      .changes()
      .then((c) => setChanges([...c.changes].reverse()))
      .catch((e: Error) => onError(e.message));
  }, [refreshKey, onError]);
  if (!changes.length) return <p className="muted">还没有任何改动。</p>;
  return (
    <section className="card table-card">
      <h2 className="section-title">改动记录</h2>
      <table className="features">
        <thead>
          <tr>
            <th>改动</th>
            <th>档位</th>
            <th>来源</th>
            <th>阶段</th>
            <th>开始</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <Fragment key={c.changeId}>
              <tr onClick={() => setOpen(open === c.changeId ? null : c.changeId)}>
                <td>
                  <div className="feature-name">{c.description || c.changeId}</div>
                  {c.unmanagedCommits.length > 0 && <div className="muted small">期间有 {c.unmanagedCommits.length} 个未经 Stagent 合并的提交</div>}
                </td>
                <td>{c.track === 'feature' ? '新功能' : '小改动'}</td>
                <td>{c.source === 'external' ? '外部改动' : 'Stagent / Claude Code'}</td>
                <td>
                  <span className={`phase phase-${c.phase}`}>{c.phaseLabel}</span>
                </td>
                <td className="muted">{relativeTime(c.startedAt)}</td>
              </tr>
              {open === c.changeId && (
                <tr>
                  <td colSpan={5}>
                    <DiffView changeId={c.changeId} features={features} refreshKey={refreshKey} onError={onError} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
