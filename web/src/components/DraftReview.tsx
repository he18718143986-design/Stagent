import { useEffect, useRef, useState } from 'react';
import type { ChangeView, PendingDraft } from '../api';
import { api, fileUrl } from '../api';
import { DecisionCard } from './DecisionCard';

interface Props {
  change: ChangeView;
  featureName: (id: string) => string;
  disabled: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}

const RED_TEXT: Record<string, string> = { failed: '实现前失败（合格）', passed: '实现前就通过了', errored: '跑不起来', flaky: '结果不稳定', not_run: '没有运行' };

/** 确认例子 → 先失败检查（§5.1）：每条草稿显示例子原文、检查的大白话摘要、先失败检查结果；不合格的出决策卡。 */
export function DraftReview({ change, featureName, disabled, act }: Props) {
  const drafts = change.pendingDrafts;
  // §14 防盖章：每条例子要你勾选「读过、和我要的一致」才能继续；可以先改；停留时间上报给健康指标。
  const [ack, setAck] = useState<Set<string>>(new Set());
  const shownAt = useRef(Date.now());
  const key = drafts.map((d) => d.exampleId).join(',');
  useEffect(() => {
    shownAt.current = Date.now();
    setAck(new Set());
  }, [key]);
  if (drafts.length === 0) return null;
  const allAck = drafts.every((d) => ack.has(d.exampleId));
  const reviewed = () => void api.metric('examples.reviewed', { ms: Date.now() - shownAt.current, count: drafts.length });
  const toggle = (id: string) => {
    const next = new Set(ack);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAck(next);
  };
  const needRed = drafts.filter((d) => !d.waiver && !d.redCheck);
  const bad = drafts.filter((d) => !d.waiver && d.redCheck && d.redCheck.status !== 'failed');
  const ok = drafts.filter((d) => d.waiver || d.redCheck?.status === 'failed');
  return (
    <div className="draft-review">
      <h3 className="section-title">验收例子（确认后先跑「先失败检查」：新行为还没实现时，检查必须失败）</h3>
      <ul className="draft-list">
        {drafts.map((d) => (
          <li key={d.exampleId}>
            <DraftLine d={d} featureName={featureName(d.featureId)} disabled={disabled} act={act} />
            <label className="inline-check ack">
              <input type="checkbox" checked={ack.has(d.exampleId)} onChange={() => toggle(d.exampleId)} disabled={disabled} />
              我读过这条例子和「检查实际在看什么」，它就是我要的行为
            </label>
          </li>
        ))}
      </ul>
      <p className="muted small">AI 写的检查你多半读不懂，那句大白话摘要是你唯一的把关点：摘要和你想要的不一致，就改例子或让 AI 重写，别直接确认。</p>
      <div className="row">
        {needRed.length > 0 && (
          <span className="action">
            <button
              className="btn btn-primary"
              disabled={disabled || !allAck}
              onClick={() => {
                reviewed();
                void act(() => api.redCheck(change.changeId));
              }}
            >
              确认这些例子，跑先失败检查
            </button>
            {!allAck && <span className="disabled-reason">先逐条勾选「读过」</span>}
          </span>
        )}
        {needRed.length === 0 && bad.length === 0 && (
          <span className="action">
            <button
              className="btn btn-primary"
              disabled={disabled || !allAck}
              onClick={() => {
                reviewed();
                void act(() => api.lockExamples(change.changeId));
              }}
            >
              确认并锁定 {ok.length} 个例子
            </button>
            {!allAck && <span className="disabled-reason">先逐条勾选「读过」</span>}
          </span>
        )}
        {needRed.length === 0 && bad.length > 0 && <span className="disabled-reason">还有 {bad.length} 条检查没测到新行为，处理后才能锁定</span>}
      </div>
      {bad.map((d) => (
        <DecisionCard
          key={d.exampleId}
          cardId={`red-${d.exampleId}`}
          question={`这条检查没测到新行为：「${d.then}」`}
          background={`它在新行为还没实现时就${d.redCheck?.status === 'passed' ? '通过了' : '跑不起来'}。如果直接锁定，"已验证"可能是假的。${d.summary ? `AI 说这条检查在看：${d.summary}` : ''}`}
          options={[
            { label: '让 AI 重写检查', pros: '重写后自动再跑一次先失败检查', recommended: true, onChoose: () => act(() => api.rewrite(change.changeId, d.exampleId)) },
            {
              label: '确认行为已存在',
              pros: '保留这条例子',
              cons: '要填原因，原因会出现在交付报告里',
              needsReason: true,
              onChoose: (reason) => act(() => api.redWaive(change.changeId, d.exampleId, reason)),
            },
            { label: '删掉这条例子', danger: true, cons: '这个行为不再有检查', onChoose: () => act(() => api.discard(change.changeId, d.exampleId)) },
          ]}
        >
          {d.redCheck?.logPath && (
            <a className="small" href={fileUrl(d.redCheck.logPath)} target="_blank" rel="noreferrer">
              查看未实现状态下的运行日志
            </a>
          )}
        </DecisionCard>
      ))}
    </div>
  );
}

function DraftLine({ d, featureName, disabled, act }: { d: PendingDraft; featureName: string; disabled: boolean; act: Props['act'] }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ given: d.given, when: d.when, then: d.then });
  if (editing) {
    return (
      <div className="grid">
        <span className="tag">{featureName}</span>
        {(['given', 'when', 'then'] as const).map((k) => (
          <label key={k} className="field">
            <span>{k === 'given' ? '情况' : k === 'when' ? '操作' : '期望'}</span>
            <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
        <div className="grid-actions">
          <button
            className="btn btn-primary small"
            disabled={disabled}
            onClick={() =>
              act(async () => {
                await api.editDraft(d.exampleId, form);
                setEditing(false);
              })
            }
          >
            保存修改
          </button>
          <button className="btn btn-ghost small" onClick={() => setEditing(false)}>
            取消
          </button>
          <span className="muted small">只改了文字时检查不变；期望变了请让 AI 重写检查。</span>
        </div>
      </div>
    );
  }
  return (
    <>
      <span className="tag">{featureName}</span> 情况：{d.given} → 操作：{d.when} → 期望：<b>{d.then}</b>
      {d.kind === 'visual' && <span className="tag">外观</span>}{' '}
      <button className="linklike small" disabled={disabled} onClick={() => setEditing(true)}>
        修改
      </button>
      {d.summary && <div className="muted small">这条检查实际在看：{d.summary}</div>}
      <div className="small">
        <code>{d.checkPath}</code>{' '}
        {d.waiver ? (
          <span className="chip chip-unverified">已豁免：{d.waiver.reason}</span>
        ) : d.redCheck ? (
          <span className={`chip ${d.redCheck.status === 'failed' ? 'chip-verified' : 'chip-failed'}`}>先失败检查：{RED_TEXT[d.redCheck.status] ?? d.redCheck.status}</span>
        ) : (
          <span className="muted">尚未跑先失败检查</span>
        )}
      </div>
    </>
  );
}
