import { useState } from 'react';
import type { ChangeView } from '../api';
import { api, fileUrl } from '../api';

/** 外观确认（§7 visual）：看截图，确认或附说明退回实现（不计入自动修复 3 轮上限）。 */
export function VisualReview({ change, disabled, act }: { change: ChangeView; disabled: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (change.phase !== 'awaiting_visual' || change.visualPending.length === 0) return null;
  return (
    <div className="visual-review">
      <h3 className="section-title">需要你看的截图</h3>
      {change.visualPending.map((v) => (
        <div key={v.exampleId} className="visual-item">
          <div>
            期望：<b>{v.then}</b>
          </div>
          {v.screenshot ? <img className="shot" src={fileUrl(v.screenshot)} alt={`截图：${v.then}`} /> : <p className="muted">这条检查没有输出截图（STAGENT_SCREENSHOT_PATH）。</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={disabled} onClick={() => act(() => api.confirmVisual(v.exampleId, true))}>
              外观 OK
            </button>
            <input
              value={notes[v.exampleId] ?? ''}
              onChange={(e) => setNotes({ ...notes, [v.exampleId]: e.target.value })}
              placeholder="不满意？写一句说明，交给 Claude Code 继续改"
            />
            <button className="btn" disabled={disabled || !notes[v.exampleId]?.trim()} onClick={() => act(() => api.confirmVisual(v.exampleId, false, notes[v.exampleId]))}>
              不满意
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
