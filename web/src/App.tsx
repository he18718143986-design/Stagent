import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe, type FeatureView, type OverviewResponse } from './api';
import { AgentStatus } from './components/AgentStatus';
import { AuthDialog, type AuthDialogSpec } from './components/AuthDialog';
import { ChangePanel } from './components/ChangePanel';
import { ConclusionCard } from './components/ConclusionCard';
import { DanglingNotice } from './components/DanglingNotice';
import { FeatureDrawer } from './components/FeatureDrawer';
import { FeatureTable } from './components/FeatureTable';
import { GuardNotice } from './components/GuardNotice';
import { PlanLine, RecordAndDriftNotices, RuleProposals } from './components/HomeExtras';
import { NewChange } from './components/NewChange';
import { Onboarding } from './components/Onboarding';
import { Stats } from './components/Stats';
import { TopBar, type Route } from './components/TopBar';
import { ChangesPage } from './pages/ChangesPage';
import { MapPage } from './pages/MapPage';
import { PlansPage } from './pages/PlansPage';
import { ReportPage } from './pages/ReportPage';
import { RulesPage } from './pages/RulesPage';

/** 兜底轮询：服务端监听到的工作区变化会经 SSE 推送，这里再定时刷新一次以防漏事件。 */
const POLL_MS = 5000;
const ROUTES: Route[] = ['ledger', 'map', 'plans', 'changes', 'rules', 'report'];

function routeOf(hash: string): Route {
  const r = hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(r) ? r : 'ledger';
}

export function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [features, setFeatures] = useState<FeatureView[]>([]);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState<null | 'auto' | 'small' | 'feature'>(null);
  const [dialog, setDialog] = useState<AuthDialogSpec | null>(null);
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.hash));
  const [tick, setTick] = useState(0);
  const pending = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [o, f] = await Promise.all([api.overview(), api.features()]);
      setOverview(o);
      setFeatures(f);
      setError(null);
      setTick((t) => t + 1);
      void api
        .map()
        .then((m) => setFileCounts(Object.fromEntries(m.features.map((x) => [x.featureId, x.files.length]))))
        .catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe(() => {
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        void refresh();
      }, 150);
    });
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onHash = () => setRoute(routeOf(window.location.hash));
    window.addEventListener('focus', onFocus);
    window.addEventListener('hashchange', onHash);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('hashchange', onHash);
    };
  }, [refresh]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );
  const onError = useCallback((m: string) => setError(m), []);

  /** 授权：成功后刷新；失败时把服务端原因显示在页首，并让对话框保持打开。 */
  const authorize = async (body: { action: string; reason: string } & Record<string, unknown>) => {
    try {
      const r = await api.authorize(body);
      setError(r.ok ? null : `已执行，但没有成功：${r.detail ?? ''}`);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      await refresh();
    }
  };
  const openNewChange = (track: 'auto' | 'small' | 'feature') => {
    window.location.hash = '#/';
    setNewOpen(track);
    setTimeout(() => document.getElementById('new-change')?.scrollIntoView({ behavior: 'smooth' }), 0);
  };
  const scrollToChange = () => {
    window.location.hash = '#/';
    setTimeout(() => document.querySelector('.change-panel')?.scrollIntoView({ behavior: 'smooth' }), 0);
  };
  const openMerge = (changeId: string) =>
    setDialog({
      title: '合并这个改动？',
      background: '服务端会重算所有锁定检查的哈希并校验账本，通过后提交到 git（git add -A + commit）。合并免填原因。',
      confirmLabel: '合并',
      reasonOptional: true,
      onConfirm: () => act(() => api.merge(changeId)),
    });
  const openOverride = (changeId: string) =>
    setDialog({
      title: '授权强行合并？',
      background: '还有失败或未验证的例子。强行合并会照常提交，但原因会写进账本、决策记录和交付报告；锁定检查被修改时仍然不能合并。',
      confirmLabel: '授权并合并',
      danger: true,
      onConfirm: (reason) => authorize({ action: 'merge_override', changeId, reason }),
    });
  const openAbandon = async (changeId: string) => {
    let extra: AuthDialogSpec['extra'];
    try {
      const p = await api.abandonPreview(changeId);
      extra = (
        <div className="dialog-files">
          <div className="meta">
            还原到 <code>{p.restoreTo.slice(0, 7)}</code>，{p.note}：
          </div>
          {p.files.length === 0 ? (
            <div className="muted">没有需要还原的文件</div>
          ) : (
            <ul>
              {p.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code> <span className="muted">{f.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setDialog({
      title: '放弃这个改动？',
      background: '工作区会还原到改动开始时的提交，下面这些文件的修改会丢失；本改动锁定的例子会解锁，本改动新建的功能会退役。',
      extra,
      confirmLabel: '授权放弃',
      danger: true,
      onConfirm: (reason) => authorize({ action: 'abandon', changeId, reason }),
    });
  };
  const openModifyLocked = (exampleId: string, label: string) =>
    setDialog({
      title: '授权修改锁定例子？',
      background: `${label} 会被解锁。改好检查后在功能详情里点「重新锁定」，系统会写新快照并自动跑全量回归；旧的运行结果不再作证。`,
      confirmLabel: '授权解锁',
      onConfirm: (reason) => authorize({ action: 'modify_locked', exampleId, reason }),
    });
  const openRetire = (f: FeatureView) =>
    setDialog({
      title: `退役功能「${f.name}」？`,
      background: `它的 ${f.lockedCount} 个锁定例子会解锁，功能从账本首页移除（历史记录仍在账本里）。`,
      confirmLabel: '授权退役',
      danger: true,
      onConfirm: async (reason) => {
        await authorize({ action: 'delete', featureId: f.featureId, reason });
        setOpenId(null);
      },
    });
  const openDeleteRecord = (recordId: string, title: string) =>
    setDialog({
      title: `删除记录「${title}」？`,
      background: '记录从「决策与规则」里移除（历史仍在账本里）。删除需要授权并填写原因。',
      confirmLabel: '授权删除',
      danger: true,
      onConfirm: (reason) => authorize({ action: 'delete', recordId, reason }),
    });
  const openRelease = () =>
    setDialog({
      title: '发布上线？',
      background: '会运行 config.json 里配置的发布命令。授权一次只执行一次；如果中途崩溃，重启后不会自动重跑。',
      confirmLabel: '授权发布',
      danger: true,
      onConfirm: (reason) => authorize({ action: 'release', reason }),
    });
  const openBudget = () => {
    let amount = '5';
    setDialog({
      title: '提高费用上限？',
      background: `${overview?.budget.exceeded?.scope === 'perChange' ? '本改动' : '今日'}费用已达到上限，Claude Code 已暂停。提高上限需要授权并填写原因。`,
      extra: (
        <label className="field">
          <span>提高多少（美元）</span>
          <input defaultValue={amount} onChange={(e) => (amount = e.target.value)} inputMode="decimal" />
        </label>
      ),
      confirmLabel: '授权提高上限',
      onConfirm: (reason) => authorize({ action: 'budget_raise', reason, amount: Number(amount) }),
    });
  };
  const openRecover = (mode: 'establish_trust' | 'from_git') =>
    setDialog({
      title: mode === 'establish_trust' ? '确认当前账本可信？' : '从 git 历史恢复账本？',
      background:
        mode === 'establish_trust'
          ? '本机没有这个账本的链头锚点（新机器或被删除），系统无法证明账本没被改过。确认后写入 ledger.trust_established 并建立锚点。'
          : '用最近一次提交的 events.jsonl 与快照恢复（是一条更短的合法链），之后未提交的事件会丢弃。',
      confirmLabel: mode === 'establish_trust' ? '我确认' : '恢复',
      reasonOptional: true,
      danger: mode === 'from_git',
      onConfirm: (reason) => act(() => api.recoverLedger(mode, reason)),
    });

  const openFeature = features.find((f) => f.featureId === openId) ?? null;
  const change = overview?.change ?? null;
  const locked = overview?.ledger.state === 'locked';
  const aiReady = overview
    ? { ok: overview.agent.availability.available && !overview.agent.task, why: !overview.agent.availability.available ? (overview.agent.availability.reason ?? 'Claude Code 不可用') : 'Claude Code 正忙' }
    : { ok: false, why: '' };
  const refreshKey = String(tick);

  return (
    <div className="app">
      <TopBar overview={overview} route={route} />
      <main className="page">
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}
        {!overview ? (
          <div className="loading">正在读取账本…</div>
        ) : route === 'map' ? (
          <MapPage features={features} refreshKey={refreshKey} onError={onError} />
        ) : route === 'plans' ? (
          <PlansPage features={features} act={act} refreshKey={refreshKey} onOpenChange={scrollToChange} aiReady={aiReady.ok} />
        ) : route === 'changes' ? (
          <ChangesPage features={features} refreshKey={refreshKey} onError={onError} />
        ) : route === 'rules' ? (
          <RulesPage act={act} refreshKey={refreshKey} onDeleteRecord={openDeleteRecord} />
        ) : route === 'report' ? (
          <ReportPage />
        ) : (
          <>
            <ConclusionCard
              overview={overview}
              onAcceptLedger={(reason) => act(() => api.acceptLedger(reason))}
              handlers={{
                run_regression: () => act(api.startRun),
                cancel_run: () => act(api.cancelRun),
                add_feature: () => openNewChange('feature'),
                new_change: () => openNewChange(overview.agent.availability.available ? 'auto' : 'small'),
                scan: () => act(api.scan),
                lock_examples: () => change && act(() => api.lockExamples(change.changeId)),
                start_check: () => change && act(() => api.startCheck(change.changeId)),
                draft_examples: () => change && act(() => api.draftWithAgent(change.changeId)),
                run_red_check: () => change && act(() => api.redCheck(change.changeId)),
                implement: () => change && act(() => api.implement(change.changeId)),
                fix: () => change && act(() => api.fix(change.changeId)),
                resume_agent: () => change && act(() => api.resume(change.changeId)),
                cancel_agent: () => act(api.cancelAgent),
                confirm_visual: scrollToChange,
                merge: () => change && openMerge(change.changeId),
                merge_override: () => change && openOverride(change.changeId),
                abandon: () => change && openAbandon(change.changeId),
                restore_locked: () =>
                  act(async () => {
                    for (const t of overview.auth.tamperedChecks) await api.restoreExample(t.exampleId);
                  }),
                modify_locked: () => {
                  const t = overview.auth.tamperedChecks[0];
                  if (t) openModifyLocked(t.exampleId, `「${t.featureName}」${t.checkPath}`);
                },
                release: () => openRelease(),
                budget_raise: () => openBudget(),
                establish_trust: () => openRecover('establish_trust'),
                restore_from_git: () => openRecover('from_git'),
                close_plan: () => overview.planLine && act(() => api.closePlan(overview.planLine!.planId, 'completed')),
              }}
            />
            <PlanLine line={overview.planLine} />
            <AgentStatus agent={overview.agent} onCancel={() => act(api.cancelAgent)} />
            <DanglingNotice dangling={overview.auth.dangling} onDismiss={(id) => act(() => api.dismissDangling(id))} />
            {overview.runError && <div className="banner banner-error">上次运行被拒绝：{overview.runError}</div>}
            <GuardNotice block={overview.lastGuardBlock} />
            <RecordAndDriftNotices overview={overview} act={act} />
            {change && (
              <ChangePanel
                change={change}
                features={features}
                disabled={locked}
                agent={overview.agent}
                act={act}
                onError={onError}
                refreshKey={refreshKey}
                onSetTrack={(track) => act(() => api.setTrack(change.changeId, track))}
                onDraft={(body) => act(() => api.draftExample(change.changeId, body))}
                onCheck={() => act(() => api.startCheck(change.changeId))}
                onMerge={() => openMerge(change.changeId)}
                onOverride={() => openOverride(change.changeId)}
                onAbandon={() => openAbandon(change.changeId)}
              />
            )}
            {!change && (newOpen || features.length > 0) && (
              <NewChange
                key={newOpen ?? 'default'}
                disabled={locked}
                aiAvailable={overview.agent.availability.available}
                {...(newOpen ? { defaultTrack: newOpen } : {})}
                act={act}
                onDone={() => setNewOpen(null)}
              />
            )}
            <Onboarding features={features} overview={overview} act={act} refreshKey={refreshKey} />
            <RuleProposals overview={overview} act={act} disabled={locked} />
            {overview.stats.features > 0 && <Stats stats={overview.stats} />}
            {features.length > 0 && <FeatureTable features={features} onOpen={setOpenId} fileCounts={fileCounts} />}
          </>
        )}
      </main>
      {openFeature && (
        <FeatureDrawer
          feature={openFeature}
          change={change}
          tampered={overview?.auth.tamperedChecks ?? []}
          onClose={() => setOpenId(null)}
          onModify={(exampleId, label) => openModifyLocked(exampleId, label)}
          onRestore={(exampleId) => act(() => api.restoreExample(exampleId))}
          onRelock={(exampleId) => act(() => api.relockExample(exampleId))}
          onRetire={() => openRetire(openFeature)}
          act={act}
          aiReady={aiReady}
          onRerun={() => act(api.startRun)}
        />
      )}
      {dialog && <AuthDialog spec={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
