import { useEffect, useState } from 'react';
import type { FeatureView, MapView } from '../api';
import { api } from '../api';
import { relativeTime } from '../format';

/** 系统地图（§4.5、§11、D27）：功能 ↔ 文件；共享热点；未归属；按文件搜索。 */
export function MapPage({ features, refreshKey, onError }: { features: FeatureView[]; refreshKey: string; onError: (m: string) => void }) {
  const [map, setMap] = useState<MapView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ path: string; features: { name: string }[] } | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const reload = () => api.map().then(setMap).catch((e: Error) => onError(e.message));
  useEffect(() => {
    void reload();
    void api.metric('map.opened');
  }, [refreshKey]); // reload 只依赖 refreshKey
  if (!map) return <div className="loading">正在读取系统地图…</div>;
  const current = map.features.find((f) => f.featureId === selected) ?? map.features[0] ?? null;
  const fv = features.find((f) => f.featureId === current?.featureId);
  const empty = map.features.every((f) => f.files.length === 0);

  return (
    <div className="map-page">
      <p className="banner banner-info">{map.note}</p>
      <div className="row search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入文件路径，看它属于哪些功能（如 src/app.js）" />
        <button className="btn" disabled={!query.trim()} onClick={() => api.fileFeatures(query.trim()).then(setFound).catch((e: Error) => onError(e.message))}>
          查找
        </button>
        {found && (
          <span className="muted">
            <code>{found.path}</code>：{found.features.length ? found.features.map((f) => f.name).join('、') : '未归属任何功能'}
          </span>
        )}
      </div>
      {empty && <p className="muted">地图还是空的：完成几次改动后会逐步形成。也可以在下方「未归属」里手动指定。</p>}
      <div className="map-grid">
        <aside className="card map-features">
          <h2 className="section-title">功能</h2>
          <ul>
            {map.features.map((f) => (
              <li key={f.featureId}>
                <button className={`map-feature ${current?.featureId === f.featureId ? 'active' : ''}`} onClick={() => setSelected(f.featureId)}>
                  <span className={`dot dot-${f.state}`} /> {f.name} <span className="muted small">{f.files.length} 个文件</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        {current && (
          <section className="card map-detail">
            <h2>{current.name}</h2>
            <div className={`feature-state state-${current.state}`}>{current.stateLabel}</div>
            <h3 className="section-title">文件（按被改次数排序）</h3>
            {current.files.length === 0 ? (
              <p className="muted">还没有归属到这个功能的文件。</p>
            ) : (
              <ul className="file-tree">
                {current.files.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code> <span className="muted small">改过 {f.count} 次</span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="section-title">例子</h3>
            {fv?.examples.length ? (
              <ul>
                {fv.examples.map((x) => (
                  <li key={x.exampleId}>
                    <span className={`chip chip-${x.state}`}>{x.state === 'verified' ? '已验证' : x.state === 'failed' ? '失败' : '未验证'}</span> {x.then}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">尚无例子。</p>
            )}
            <h3 className="section-title">最近 5 次改动</h3>
            {current.recentChanges.length ? (
              <ul>
                {current.recentChanges.map((c) => (
                  <li key={c.changeId}>
                    {c.description || c.changeId} <span className="muted small">{relativeTime(c.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">还没有合并过为它改文件的改动。</p>
            )}
          </section>
        )}
      </div>
      <section className="card">
        <h2 className="section-title">共享热点（被 ≥ 3 个功能共享，改这里最容易误伤别的功能）</h2>
        {map.hotspots.length === 0 ? (
          <p className="muted">暂无。</p>
        ) : (
          <ul>
            {map.hotspots.map((h) => (
              <li key={h.path}>
                <code>{h.path}</code>：{h.features.map((f) => f.name).join('、')}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2 className="section-title">
          未归属（{map.unassigned.length} / {map.trackedFileCount} 个文件）
        </h2>
        <ul className="unassigned">
          {map.unassigned.slice(0, 100).map((p) => (
            <li key={p}>
              <code>{p}</code>
              <select value={assign[p] ?? ''} onChange={(e) => setAssign({ ...assign, [p]: e.target.value })}>
                <option value="">选择功能…</option>
                {map.features.map((f) => (
                  <option key={f.featureId} value={f.featureId}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                className="btn small"
                disabled={!assign[p]}
                onClick={() =>
                  api
                    .reassign(p, [assign[p]!])
                    .then(reload)
                    .catch((e: Error) => onError(e.message))
                }
              >
                归属
              </button>
            </li>
          ))}
          {map.unassigned.length > 100 && <li className="muted">…还有 {map.unassigned.length - 100} 个</li>}
        </ul>
      </section>
    </div>
  );
}
