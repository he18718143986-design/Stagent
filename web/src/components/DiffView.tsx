import { useEffect, useState } from 'react';
import type { ChangeDiffView, FeatureView } from '../api';
import { api, fileUrl } from '../api';

const STATUS: Record<string, string> = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' };

/** 「改了什么」（D20）：基准 → 工作区；触及的功能；按功能的大白话说明与截图；超出本功能的改动；文件归属；可展开 diff。 */
export function DiffView({ changeId, features, refreshKey, onError }: { changeId: string; features: FeatureView[]; refreshKey: string; onError: (m: string) => void }) {
  const [diff, setDiff] = useState<ChangeDiffView | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .diff(changeId)
      .then((d) => alive && setDiff(d))
      .catch((err: Error) => alive && onError(err.message));
    return () => {
      alive = false;
    };
  }, [changeId, refreshKey, onError]);
  if (!diff) return <p className="muted">正在读取改动…</p>;
  const save = async (path: string, featureId: string) => {
    try {
      await api.setAttributions(changeId, [{ path, featureIds: featureId ? [featureId] : [] }]);
      setEditing(null);
      setDiff(await api.diff(changeId));
    } catch (err) {
      onError((err as Error).message);
    }
  };
  return (
    <div className="diff-view">
      <p className="meta">
        基准 <code>{diff.base.slice(0, 7)}</code> → 工作区 · {diff.totals.files} 个文件 · <span className="add">+{diff.totals.added}</span> <span className="del">-{diff.totals.deleted}</span> · 来源：
        {diff.source === 'external' ? '外部改动（Cursor / 手写）' : 'Claude Code'}
      </p>
      {diff.summary && (
        <div className="claim-summary">
          <div className="meta">AI 的说明（仅声称）：</div>
          <p>{diff.summary}</p>
        </div>
      )}
      {diff.touchedFeatures.length > 0 && (
        <p>
          触及的功能：{diff.touchedFeatures.map((f) => <span key={f.featureId} className="tag">{f.name}</span>)}
        </p>
      )}
      {diff.outsideScope && diff.outsideScope.length > 0 && (
        <div className="banner banner-warn">
          <b>超出本功能的改动</b>（目标：{diff.targetFeatures.map((f) => f.name).join('、')}）
          <ul>
            {diff.outsideScope.map((o) => (
              <li key={o.path}>
                <code>{o.path}</code> {o.reason === 'hotspot' ? '共享热点，' : ''}属于 {o.features.map((f) => f.name).join('、')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {diff.failureLocations.filter((f) => f.files.length).map((f) => (
        <div key={f.featureId} className="banner banner-error">
          「{f.name}」被破坏，可能相关的改动文件：{f.files.map((p) => <code key={p}>{p}</code>)}
        </div>
      ))}
      {diff.screenshots.length > 0 && (
        <div className="shots">
          {diff.screenshots.map((s) => (
            <figure key={s.exampleId}>
              <figcaption>
                {s.featureName}：{s.then}
              </figcaption>
              <div className="shot-pair">
                {s.before ? <img className="shot" src={fileUrl(s.before)} alt="改前" /> : <span className="muted">（无改前截图）</span>}
                {s.after ? <img className="shot" src={fileUrl(s.after)} alt="改后" /> : <span className="muted">（无改后截图）</span>}
              </div>
            </figure>
          ))}
        </div>
      )}
      <table className="files">
        <thead>
          <tr>
            <th>文件</th>
            <th>变化</th>
            <th>归属功能（可修改）</th>
          </tr>
        </thead>
        <tbody>
          {diff.files.map((f) => (
            <tr key={f.path}>
              <td>
                <details>
                  <summary>
                    <code>{f.path}</code>
                    {f.from && <span className="muted small"> ← {f.from}</span>}
                  </summary>
                  {f.diff ? <pre className="log diff">{f.diff}</pre> : <span className="muted">没有可显示的 diff</span>}
                </details>
              </td>
              <td className="small">
                {STATUS[f.status]} <span className="add">+{f.added}</span> <span className="del">-{f.deleted}</span>
              </td>
              <td className="small">
                {editing === f.path ? (
                  <select autoFocus defaultValue={f.featureIds[0] ?? ''} onChange={(e) => save(f.path, e.target.value)} onBlur={() => setEditing(null)}>
                    <option value="">未归属</option>
                    {features.map((x) => (
                      <option key={x.featureId} value={x.featureId}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button className="linklike" onClick={() => setEditing(f.path)} disabled={diff.attributions === undefined}>
                    {f.featureIds.length ? f.featureIds.map((id) => features.find((x) => x.featureId === id)?.name ?? id).join('、') : '未归属'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
