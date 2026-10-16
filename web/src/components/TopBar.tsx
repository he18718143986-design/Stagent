import type { OverviewResponse } from '../api';

export type Route = 'ledger' | 'map' | 'plans' | 'changes' | 'rules' | 'report';

export const NAV: { route: Route; label: string }[] = [
  { route: 'ledger', label: '功能账本' },
  { route: 'map', label: '系统地图' },
  { route: 'plans', label: '需求计划' },
  { route: 'changes', label: '改动记录' },
  { route: 'rules', label: '决策与规则' },
  { route: 'report', label: '交付报告' },
];

export function TopBar({ overview, route }: { overview: OverviewResponse | null; route: Route }) {
  const running = overview?.run != null;
  const agentBusy = overview?.agent.task != null;
  const b = overview?.budget;
  const cost = b ? `今日费用 $${b.todayCost.toFixed(2)}${b.perDay !== null ? ` / $${b.perDay.toFixed(2)}` : ''}` : '今日费用 —';
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span className="brand-name">Stagent</span>
          {overview && (
            <>
              <span className="divider">/</span>
              <span className="project">{overview.project.name}</span>
              {overview.project.branch && <span className="branch">⎇ {overview.project.branch}</span>}
              {overview.project.port && <span className="branch">:{overview.project.port}</span>}
            </>
          )}
        </div>
        <div className="topbar-meta">
          <span className={`pill ${running || agentBusy ? 'pill-busy' : ''}`}>
            执行器：{running ? '检查中' : agentBusy ? `Claude Code ${overview?.agent.task?.label}` : '空闲'}
          </span>
          {overview && !overview.agent.availability.available && (
            <span className="pill pill-muted" title={overview.agent.availability.hint}>
              Claude Code：{overview.agent.availability.reason}
            </span>
          )}
          <span className={`pill ${b?.exceeded ? 'pill-bad' : 'pill-muted'}`}>{cost}</span>
        </div>
      </div>
      <nav className="nav">
        {NAV.map((n) => (
          <a key={n.route} href={`#/${n.route === 'ledger' ? '' : n.route}`} className={`nav-item ${route === n.route ? 'active' : ''}`}>
            {n.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
