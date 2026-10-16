import { useEffect, useState } from 'react';
import type { ChangeView, ExampleView, FeatureView, OverviewResponse } from '../api';
import { api, fileUrl } from '../api';
import { relativeTime } from '../format';
import { DecisionCard } from './DecisionCard';
import { ProgressSteps } from './ProgressSteps';

const STATE_TEXT: Record<ExampleView['state'], string> = { verified: '已验证', failed: '失败', unverified: '未验证' };
const REASON_TEXT: Record<NonNullable<ExampleView['reason']>, string> = {
  ai_claim_only: '仅 AI 声称',
  errored: '执行异常',
  flaky: '结果不稳定',
  invalid: '证据无效',
  stale: '证据过期',
  not_run: '未执行',
};

/** 详情抽屉：本功能属于进行中的改动时显示档位与流程进度；证据区列出例子与原因。「改了什么」在 M4-2。 */
interface Props {
  feature: FeatureView;
  change: ChangeView | null;
  tampered: OverviewResponse['auth']['tamperedChecks'];
  onClose: () => void;
  onModify: (exampleId: string, label: string) => void;
  onRestore: (exampleId: string) => void;
  onRelock: (exampleId: string) => void;
  onRetire: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  aiReady: { ok: boolean; why: string };
  onRerun: () => void;
}

const RED: Record<ExampleView['redCheck']['kind'], string> = {
  failed: '先失败检查：实现前失败（合格）',
  waived: '先失败检查：已豁免',
  baseline: '基线例子（描述已有行为，不做先失败检查）',
  none: '锁定时未记录先失败检查',
};

export function FeatureDrawer({ feature, change, tampered, onClose, onModify, onRestore, onRelock, onRetire, act, aiReady, onRerun }: Props) {
  const [related, setRelated] = useState<string[]>([]);
  const [files, setFiles] = useState<{ path: string; count: number }[]>([]);
  useEffect(() => {
    void api.metric('drawer.opened');
    void api
      .map()
      .then((m) => setFiles(m.features.find((f) => f.featureId === feature.featureId)?.files ?? []))
      .catch(() => undefined);
    if (change && feature.state === 'broken') {
      void api
        .diff(change.changeId)
        .then((d) => setRelated(d.failureLocations.find((f) => f.featureId === feature.featureId)?.files ?? []))
        .catch(() => undefined);
    } else setRelated([]);
  }, [feature.featureId, feature.state, change]);
  const inChange =
    change !== null &&
    (change.draftedExampleIds.some((id) => feature.examples.some((x) => x.exampleId === id)) ||
      change.pendingDrafts.some((d) => d.featureId === feature.featureId));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label={`${feature.name} 详情`}>
        <header className="drawer-head">
          <div>
            <h2>{feature.name}</h2>
            <div className={`feature-state state-${feature.state}`}>{feature.stateLabel}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="drawer-body">
          {inChange && change && (
            <div className="drawer-change">
              <div className="meta">
                {change.track === 'feature' ? '新功能档' : '小改动档'} · {change.description} · 当前：{change.phaseLabel}
              </div>
              <ProgressSteps change={change} />
            </div>
          )}
          {change?.phase === 'blocked' && change.blockers.length > 0 && (
            <div className="banner banner-error">被阻止：{change.blockers[0]}</div>
          )}
          <h3 className="section-title">证据 · 本功能的例子</h3>
          {feature.examples.length === 0 && (
            <div>
              <p className="muted">尚无锁定例子。{feature.draftCount > 0 ? `有 ${feature.draftCount} 个草稿待锁定。` : ''}</p>
              <span className="action">
                <button className="btn" disabled={!aiReady.ok} onClick={() => act(() => api.baselineDraft(feature.featureId))}>
                  补例子（Claude Code 起草基线例子）
                </button>
                {!aiReady.ok && <span className="disabled-reason">{aiReady.why}</span>}
              </span>
            </div>
          )}
          {related.length > 0 && (
            <div className="banner banner-error">
              可能相关的改动文件：{related.map((p) => <code key={p}>{p}</code>)}
              <div className="muted small">来自系统地图：这个功能的文件 ∩ 本改动的 diff（只是提示，已一并交给修复）。</div>
            </div>
          )}
          {feature.examples.map((x) => (
            <details key={x.exampleId} className={`example ex-${x.state}`} open={x.state !== 'verified'}>
              <summary>
                <span className={`chip chip-${x.state}`}>
                  {STATE_TEXT[x.state]}
                  {x.reason ? ` · ${REASON_TEXT[x.reason]}` : ''}
                </span>
                <span className="example-then">{x.then}</span>
                {x.kind === 'visual' && <span className="tag">外观</span>}
              </summary>
              <dl className="gwt">
                <dt>情况</dt>
                <dd>{x.given}</dd>
                <dt>操作</dt>
                <dd>{x.when}</dd>
                <dt>期望</dt>
                <dd>{x.then}</dd>
              </dl>
              <p className="explanation">{x.explanation}</p>
              {(x.reason === 'stale' || x.reason === 'invalid' || x.reason === 'flaky') && (
                <button className="btn small" onClick={onRerun}>
                  重新验证
                </button>
              )}
              {x.summary && <p className="meta">这条检查实际在看：{x.summary}</p>}
              <p className="meta">{x.redCheck.kind === 'waived' ? `${RED.waived}：${x.redCheck.reason}` : RED[x.redCheck.kind]}</p>
              {x.knownInconsistent && <p className="meta">已知不一致：{x.knownInconsistent.reason}</p>}
              {x.lastResult?.screenshot && <img className="shot" src={fileUrl(x.lastResult.screenshot)} alt={`截图：${x.then}`} />}
              {x.lastResult && x.lastResult.attemptLogs.length > 1 && (
                <ul className="attempts">
                  {x.lastResult.attemptLogs.map((a, i) => (
                    <li key={a.logPath}>
                      第 {i + 1} 次：{a.status}{' '}
                      <a href={fileUrl(a.logPath)} target="_blank" rel="noreferrer">
                        日志
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {x.state === 'failed' && x.lastResult?.purpose === 'baseline' && !x.knownInconsistent && (
                <DecisionCard
                  cardId={`baseline-${x.exampleId}`}
                  question="现有行为与例子不一致"
                  background="基线失败不会自动改代码。选一个处理方式："
                  options={[
                    { label: '修改例子', pros: '例子写错了', cons: '已锁定，需要授权解锁', onChoose: () => onModify(x.exampleId, `例子「${x.then}」`) },
                    {
                      label: '作为新改动去修复',
                      recommended: true,
                      pros: '代码确实有问题',
                      onChoose: () => act(() => api.createChange(`修复「${feature.name}」：${x.then}`, 'small', true)),
                    },
                    {
                      label: '接受现状',
                      cons: '记一条踩坑，功能标「已知不一致」，交付报告中列出',
                      needsReason: true,
                      onChoose: (reason) => act(() => api.knownInconsistent(x.exampleId, reason)),
                    },
                  ]}
                />
              )}
              {x.lastResult && (
                <p className="meta">
                  最近运行 {relativeTime(x.lastResult.at)} · 结果 {x.lastResult.status}
                  {x.lastResult.attempts > 1 ? ` · 共 ${x.lastResult.attempts} 次尝试` : ''}
                  {x.lastResult.logPath && (
                    <>
                      {' '}
                      · 日志 <code>{x.lastResult.logPath}</code>
                    </>
                  )}
                </p>
              )}
              {x.claims.length > 0 && (
                <div className="claims">
                  <div className="meta">AI 回报（仅声称，不作证）：</div>
                  {x.claims.map((c) => (
                    <blockquote key={c.at}>{c.text}</blockquote>
                  ))}
                </div>
              )}
              <p className="meta">
                检查 <code>{x.checkPath}</code> · 锁定于 {relativeTime(x.lockedAt)}
              </p>
              {tampered.some((t) => t.exampleId === x.exampleId) && (
                <div className="banner banner-error">
                  锁定检查在工作区被修改，合并门会拒绝。
                  <button className="btn" onClick={() => onRestore(x.exampleId)}>
                    还原锁定文件
                  </button>
                </div>
              )}
              <div className="example-actions">
                <button className="btn btn-ghost" onClick={() => onModify(x.exampleId, `例子「${x.then}」`)}>
                  授权修改这个例子
                </button>
              </div>
            </details>
          ))}
          {feature.unlockedForEdit.length > 0 && (
            <>
              <h3 className="section-title">已授权解锁、等待重新锁定</h3>
              {feature.unlockedForEdit.map((u) => (
                <div key={u.exampleId} className="example ex-unverified">
                  <div className="example-then">{u.then}</div>
                  <p className="meta">
                    {u.reason} · 改好 <code>{u.checkPath}</code> 后重新锁定，系统会写新快照并自动跑全量回归
                  </p>
                  <button className="btn btn-primary" onClick={() => onRelock(u.exampleId)}>
                    重新锁定
                  </button>
                </div>
              ))}
            </>
          )}
          <h3 className="section-title">功能文件（来自改动历史，只是提示）</h3>
          {files.length === 0 ? (
            <p className="muted">还没有归属到这个功能的文件。</p>
          ) : (
            <ul className="file-tree">
              {files.slice(0, 12).map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code> <span className="muted small">改过 {f.count} 次</span>
                </li>
              ))}
            </ul>
          )}
          <div className="drawer-footer">
            <button className="btn btn-ghost-danger" onClick={onRetire}>
              退役这个功能（需授权）
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
