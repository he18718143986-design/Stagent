import { useEffect, useState } from 'react';
import type { FeatureView, PlanView, PlansProjection } from '../api';
import { api } from '../api';
import { DecisionCard } from '../components/DecisionCard';

type Act = (fn: () => Promise<unknown>) => Promise<void>;

/** 需求计划（§5.5、D28）：大需求先拆成有序步骤，由你确认，每步是一个普通改动。 */
export function PlansPage({ features, act, refreshKey, onOpenChange, aiReady }: { features: FeatureView[]; act: Act; refreshKey: string; onOpenChange: () => void; aiReady: boolean }) {
  const [plans, setPlans] = useState<PlansProjection | null>(null);
  const [requirement, setRequirement] = useState('');
  useEffect(() => {
    void api.plans().then(setPlans).catch(() => undefined);
    void api.metric('plans.opened');
  }, [refreshKey]);
  if (!plans) return <div className="loading">正在读取需求计划…</div>;
  const names = new Map(features.map((f) => [f.featureId, f.name]));
  const drafts = plans.plans.filter((p) => p.status === 'draft');
  const past = plans.plans.filter((p) => p.status === 'completed' || p.status === 'cancelled');
  return (
    <div className="plans-page">
      {plans.active ? (
        <PlanCard plan={plans.active} names={names} act={act} onOpenChange={onOpenChange} />
      ) : (
        <section className="card">
          <h2 className="section-title">拆一个大需求</h2>
          <p className="muted">跨多个功能的大需求，先拆成 2–8 个有序步骤；每一步合并后系统都可用，能用 1–4 个例子验收。</p>
          <div className="row">
            <input value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="例如：加会员体系（会员等级、会员价、积分）" />
            <button className="btn btn-primary" disabled={!aiReady || !requirement.trim()} onClick={() => act(() => api.draftPlan(requirement.trim()).then(() => setRequirement('')))}>
              让 Claude Code 起草计划
            </button>
          </div>
          {!aiReady && <span className="disabled-reason">Claude Code 不可用或正忙</span>}
        </section>
      )}
      {drafts.map((p) => (
        <DraftPlan key={p.planId} plan={p} names={names} act={act} />
      ))}
      {past.length > 0 && (
        <section className="card">
          <h2 className="section-title">已结束的计划</h2>
          <ul>
            {past.map((p) => (
              <li key={p.planId}>
                {p.requirement} · {p.statusLabel} · {p.progress.done}/{p.progress.total}
                {p.closedReason ? `（${p.closedReason}）` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DraftPlan({ plan, names, act }: { plan: PlanView; names: Map<string, string>; act: Act }) {
  const [steps, setSteps] = useState(plan.steps.map(({ stepId, title, intent, track, featureIds, dependsOn }) => ({ stepId, title, intent, track, featureIds, dependsOn })));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    setSteps(next);
  };
  return (
    <section className="card">
      <h2 className="section-title">计划草稿：{plan.requirement}</h2>
      {plan.rationale && <p className="muted">拆分理由：{plan.rationale}</p>}
      <ol className="plan-steps">
        {steps.map((s, i) => (
          <li key={s.stepId}>
            <input value={s.title} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <span className="tag">{s.track === 'feature' ? '新功能' : '小改动'}</span>
            <div className="muted small">
              {s.intent}
              {s.featureIds?.length ? ` · 涉及：${s.featureIds.map((id) => names.get(id) ?? id).join('、')}` : ''}
              {s.dependsOn?.length ? ` · 依赖：${s.dependsOn.join('、')}` : ''}
            </div>
            <span className="row">
              <button className="btn btn-ghost small" disabled={i === 0} onClick={() => move(i, -1)}>
                上移
              </button>
              <button className="btn btn-ghost small" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                下移
              </button>
              <button
                className="btn btn-ghost small"
                disabled={steps.length <= 1}
                onClick={() => setSteps(steps.filter((_, j) => j !== i).map((x) => ({ ...x, dependsOn: (x.dependsOn ?? []).filter((d) => d !== s.stepId) })))}
              >
                删除
              </button>
            </span>
          </li>
        ))}
      </ol>
      <DecisionCard
        cardId={`plan-${plan.planId}`}
        question="按这个计划逐步做？"
        background="确认后计划页逐步显示状态；你点「开始这一步」才会创建改动，下一步不会自动开始。"
        options={[
          { label: '确认计划', recommended: true, pros: '每步单独验收', onChoose: () => act(() => api.confirmPlan(plan.planId, steps)) },
          { label: '取消', danger: true, onChoose: () => act(() => api.closePlan(plan.planId, 'cancelled', '不拆计划')) },
        ]}
      />
    </section>
  );
}

function PlanCard({ plan, names, act, onOpenChange }: { plan: PlanView; names: Map<string, string>; act: Act; onOpenChange: () => void }) {
  const [revise, setRevise] = useState(false);
  const [reason, setReason] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const pct = plan.progress.total ? (plan.progress.done / plan.progress.total) * 100 : 0;
  return (
    <section className="card">
      <h2 className="section-title">进行中的计划</h2>
      <p>
        需求：<b>{plan.requirement}</b>
      </p>
      <div className="progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-text">
          {plan.progress.done}/{plan.progress.total}
        </span>
      </div>
      <ol className="plan-steps">
        {plan.steps.map((s) => (
          <li key={s.stepId} className={`step-${s.status}`}>
            <div>
              <b>{s.title}</b> <span className="tag">{s.track === 'feature' ? '新功能' : '小改动'}</span> <span className={`chip step-chip-${s.status}`}>{s.statusLabel}</span>
              {s.changePhaseLabel && s.status === 'in_progress' && <span className="muted small"> · 改动{s.changePhaseLabel}</span>}
            </div>
            <div className="muted small">
              {s.intent}
              {s.featureIds?.length ? ` · 涉及：${s.featureIds.map((id) => names.get(id) ?? id).join('、')}` : ''}
            </div>
            {(s.status === 'ready' || s.status === 'redo') && (
              <button className="btn btn-primary small" onClick={() => act(() => api.startStep(plan.planId, s.stepId))}>
                开始这一步
              </button>
            )}
            {s.status === 'in_progress' && (
              <button className="btn small" onClick={onOpenChange}>
                查看改动
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="muted small">「已完成」只说明该步的改动已合并，不代表其功能当前仍为已验证；看功能账本里的当前状态。</p>
      <div className="row">
        {plan.progress.done === plan.progress.total && (
          <button className="btn btn-primary" onClick={() => act(() => api.closePlan(plan.planId, 'completed'))}>
            关闭计划
          </button>
        )}
        <button className="btn" onClick={() => setRevise(!revise)}>
          修改计划
        </button>
        <button className="btn btn-ghost-danger" onClick={() => window.confirm('取消这个计划？已合并的改动不受影响。') && act(() => api.closePlan(plan.planId, 'cancelled', '用户取消'))}>
          取消计划
        </button>
      </div>
      {revise && (
        <div className="revise">
          <p className="muted small">已完成的步骤不能删除或改写；可以追加步骤或修改未开始的步骤。</p>
          <div className="row">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="追加一步（标题）" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填，至少 4 个字）" />
            <button
              className="btn"
              disabled={!newTitle.trim() || [...reason.trim()].length < 4}
              onClick={() =>
                act(() =>
                  api.revisePlan(
                    plan.planId,
                    [
                      ...plan.steps.map(({ stepId, title, intent, track, featureIds, dependsOn }) => ({ stepId, title, intent, track, featureIds, dependsOn })),
                      { stepId: `s${plan.steps.length + 1}-${Date.now() % 1000}`, title: newTitle.trim(), intent: newTitle.trim(), track: 'feature', featureIds: [], dependsOn: [] },
                    ],
                    reason.trim(),
                  ),
                )
              }
            >
              追加
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
