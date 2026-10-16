import type { OverviewResponse } from '../api';
import { relativeTime } from '../format';

/** 「进行中」区域：只显示一行状态，日志可以展开；不展示 Agent 内部细节（§8）。 */
export function AgentStatus({ agent, onCancel }: { agent: OverviewResponse['agent']; onCancel: () => void }) {
  const t = agent.task;
  if (!t && !agent.lastError) return null;
  if (!t) {
    return (
      <div className="banner banner-warn" role="status">
        Claude Code：{agent.lastError}
      </div>
    );
  }
  return (
    <section className="card agent-status" aria-label="Claude Code 进行中">
      <div className="agent-line">
        <span className="spinner" aria-hidden />
        <b>Claude Code · {t.label}</b>
        <span className="muted">{t.line}</span>
        <span className="muted small">开始于 {relativeTime(t.startedAt)}</span>
        {t.kind !== 'ask' && (
          <button className="btn btn-ghost small" onClick={onCancel}>
            停止
          </button>
        )}
      </div>
      {t.log.length > 0 && (
        <details>
          <summary className="muted small">展开日志（{t.log.length} 条）</summary>
          <pre className="log">{t.log.slice(-60).join('\n')}</pre>
        </details>
      )}
      <p className="muted small">AI 的回报只算「声称」，系统会亲自运行检查后才给结论。</p>
    </section>
  );
}
