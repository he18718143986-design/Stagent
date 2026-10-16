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
  if (drafts.length === 0) return null;
  const needRed = drafts.filter((d) => !d.waiver && !d.redCheck);
  const bad = drafts.filter((d) => !d.waiver && d.redCheck && d.redCheck.status !== 'failed');
  const ok = drafts.filter((d) => d.waiver || d.redCheck?.status === 'failed');
  return (
    <div className="draft-review">
      <h3 className="section-title">验收例子（确认后先跑「先失败检查」：新行为还没实现时，检查必须失败）</h3>
      <ul className="draft-list">
        {drafts.map((d) => (
          <li key={d.exampleId}>
            <DraftLine d={d} featureName={featureName(d.featureId)} />
          </li>
        ))}
      </ul>
      <div className="row">
        {needRed.length > 0 && (
          <button className="btn btn-primary" disabled={disabled} onClick={() => act(() => api.redCheck(change.changeId))}>
            确认这些例子，跑先失败检查
          </button>
        )}
        {needRed.length === 0 && bad.length === 0 && (
          <button className="btn btn-primary" disabled={disabled} onClick={() => act(() => api.lockExamples(change.changeId))}>
            确认并锁定 {ok.length} 个例子
          </button>
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

function DraftLine({ d, featureName }: { d: PendingDraft; featureName: string }) {
  return (
    <>
      <span className="tag">{featureName}</span> 情况：{d.given} → 操作：{d.when} → 期望：<b>{d.then}</b>
      {d.kind === 'visual' && <span className="tag">外观</span>}
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
