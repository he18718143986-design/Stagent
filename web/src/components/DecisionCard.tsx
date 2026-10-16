import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export interface DecisionOption {
  label: string;
  pros?: string;
  cons?: string;
  recommended?: boolean;
  /** 选这个需要填原因（≥ 4 个字）。 */
  needsReason?: boolean;
  danger?: boolean;
  disabled?: string;
  onChoose: (reason: string) => void | Promise<void>;
}

interface Props {
  cardId: string;
  question: string;
  background: string;
  options: DecisionOption[];
  /** 其余内容（例子原文、日志链接等）。 */
  children?: React.ReactNode;
}

/** 决策卡（D17）：问题、背景、2–3 个选项（带利弊，推荐项有标签），以及「我有疑问」。 */
export function DecisionCard({ cardId, question, background, options, children }: Props) {
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
  }, [cardId]);

  const choose = async (i: number) => {
    const o = options[i]!;
    if (o.needsReason && reasonFor !== i) {
      setReasonFor(i);
      return;
    }
    setBusy(true);
    try {
      void api.metric('decision.dwell', { cardId, ms: Date.now() - shownAt.current, option: o.label });
      await o.onChoose(reason.trim());
      setReasonFor(null);
      setReason('');
    } finally {
      setBusy(false);
    }
  };
  const ask = async () => {
    setBusy(true);
    try {
      const r = await api.ask(cardId, q, { question, background, options: options.map(({ label, pros, cons }) => ({ label, pros, cons })) });
      setAnswer(r.answer);
    } catch (err) {
      setAnswer(`没能回答：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="decision" role="group" aria-label={question}>
      <div className="decision-q">{question}</div>
      <p className="decision-bg">{background}</p>
      {children}
      <div className="decision-options">
        {options.map((o, i) => (
          <div key={o.label} className={`decision-option ${o.recommended ? 'recommended' : ''}`}>
            <button
              className={o.recommended ? 'btn btn-primary' : o.danger ? 'btn btn-ghost-danger' : 'btn'}
              disabled={busy || !!o.disabled || (reasonFor === i && [...reason.trim()].length < 4)}
              onClick={() => choose(i)}
            >
              {o.label}
              {o.recommended && <span className="rec-tag">推荐</span>}
            </button>
            {(o.pros || o.cons || o.disabled) && (
              <div className="pros-cons">
                {o.disabled ? <span className="disabled-reason">{o.disabled}</span> : null}
                {o.pros && <span className="pro">＋ {o.pros}</span>}
                {o.cons && <span className="con">－ {o.cons}</span>}
              </div>
            )}
            {reasonFor === i && (
              <label className="field">
                <span>原因（至少 4 个字，会写进账本和交付报告）</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="decision-ask">
        {!asking ? (
          <button className="btn btn-ghost small" onClick={() => setAsking(true)}>
            我有疑问
          </button>
        ) : (
          <div className="row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例如：豁免会有什么风险？" />
            <button className="btn" disabled={busy || !q.trim()} onClick={ask}>
              问 Claude Code
            </button>
          </div>
        )}
        {answer && <blockquote className="answer">{answer}</blockquote>}
      </div>
    </div>
  );
}
