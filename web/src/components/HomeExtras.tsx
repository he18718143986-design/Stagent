import type { OverviewResponse } from '../api';
import { api } from '../api';
import { DecisionCard } from './DecisionCard';

type Act = (fn: () => Promise<unknown>) => Promise<void>;

/** 结论卡下方的一行：「计划：会员体系 · 第 2/5 步 · 进行中」（§11）。 */
export function PlanLine({ line }: { line: OverviewResponse['planLine'] }) {
  if (!line) return null;
  return (
    <a className="plan-line" href="#/plans">
      计划：{line.title} · 第 {line.current}/{line.total} 步 · {line.statusLabel}
      {line.allDone && <b> · 全部完成，可以关闭计划</b>}
    </a>
  );
}

/** 规则提案卡（§10）：同标签踩坑达到 2 条时出现。 */
export function RuleProposals({ overview, act, disabled }: { overview: OverviewResponse; act: Act; disabled: boolean }) {
  if (!overview.ruleProposals.length) return null;
  return (
    <section className="card" aria-label="规则提案">
      <h2 className="section-title">规则提案</h2>
      {overview.ruleProposals.map((r) => (
        <DecisionCard
          key={r.ruleId}
          cardId={`rule-${r.ruleId}`}
          question={`把这条规则写进 CLAUDE.md 和 .cursor/rules？`}
          background={`「${r.tags.join('、')}」类踩坑已经出现 2 次。规则：${r.text}（适用：${r.appliesWhen}；失效：${r.expiresWhen}）`}
          options={[
            { label: '接受规则', recommended: true, pros: '之后 Claude Code 和 Cursor 都会读到', disabled: disabled ? '账本被修改' : undefined, onChoose: () => act(() => api.acceptRule(r.ruleId)) },
            { label: '接受并同步到个人通用库', pros: '新项目接入时可以挑选', onChoose: () => act(() => api.acceptRule(r.ruleId, { library: true })) },
            { label: '不要这条规则', danger: true, onChoose: () => act(() => api.retireRule(r.ruleId)) },
          ]}
        />
      ))}
    </section>
  );
}

export function RecordAndDriftNotices({ overview, act }: { overview: OverviewResponse; act: Act }) {
  return (
    <>
      {overview.recordDraftCount > 0 && (
        <div className="banner banner-info">
          有 {overview.recordDraftCount} 张记录卡等你保存（AI 根据刚合并的改动起草）。<a href="#/rules">去看看</a>
        </div>
      )}
      {overview.rulesDrift.length > 0 && (
        <div className="banner banner-warn">
          规则区块已偏离账本：{overview.rulesDrift.map((d) => `${d.file}（${d.problem === 'missing' ? '区块缺失' : '被手动修改'}）`).join('、')}
          <div className="row">
            <button className="btn" onClick={() => act(api.regenerateRules)}>
              以账本为准重新生成
            </button>
            <button className="btn btn-ghost" onClick={() => act(api.keepRules)}>
              保留现状
            </button>
          </div>
        </div>
      )}
    </>
  );
}
