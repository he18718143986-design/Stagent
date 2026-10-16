import { useEffect, useState } from 'react';
import { api } from '../api';

type Health = Awaited<ReturnType<typeof api.health>>;
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** 交付报告（§11、D26）：一页式 HTML，可另存为 PDF（环境缺 Chromium 时降级为 HTML 并注明）。 */
export function ReportPage() {
  const [version, setVersion] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    void api.health().then(setHealth).catch(() => undefined);
  }, [version]);
  return (
    <div className="report-page">
      {health && <HealthCard h={health} />}
      <div className="row">
        <a className="btn btn-primary" href="/api/report?format=html" target="_blank" rel="noreferrer">
          在新窗口打开 HTML
        </a>
        <a className="btn" href="/api/report?format=pdf" target="_blank" rel="noreferrer">
          导出 PDF
        </a>
        <button className="btn btn-ghost" onClick={() => setVersion((v) => v + 1)}>
          重新生成
        </button>
        <span className="muted small">报告内容只来自账本；AI 的回报只算声称，会明确标出。</span>
      </div>
      <iframe key={version} className="report-frame" title="交付报告" src={`/api/report?format=html&v=${version}`} />
    </div>
  );
}

/** §14 产品健康指标：只在本机，不进交付报告。最重要的是「防盖章」。 */
function HealthCard({ h }: { h: Health }) {
  const c = h.confirmations;
  return (
    <section className="card" aria-label="健康指标">
      <h2 className="section-title">健康指标（只在本机，不进交付报告）</h2>
      {h.rubberStamp.text && <div className="banner banner-warn">{h.rubberStamp.text}</div>}
      <table className="files">
        <tbody>
          <tr>
            <td>例子确认时的修改率（防盖章）</td>
            <td>
              {pct(c.editRate)}（AI 起草并确认 {c.aiDrafted} 条，改过 {c.edited} 条）
            </td>
          </tr>
          <tr>
            <td>每条例子的审阅停留（中位数）</td>
            <td>{c.medianDwellPerExampleMs === null ? '还没有数据' : `${(c.medianDwellPerExampleMs / 1000).toFixed(1)} 秒（${c.dwellSamples} 次确认）`}</td>
          </tr>
          <tr>
            <td>先失败检查不合格率（AI 写出"空检查"的频率）</td>
            <td>
              {pct(h.redCheck.unqualifiedRate)}（{h.redCheck.unqualified}/{h.redCheck.results}）
            </td>
          </tr>
          <tr>
            <td>先失败检查豁免率</td>
            <td>
              {pct(h.redCheck.waiveRate)}（{h.redCheck.waived}/{h.redCheck.locked}）
            </td>
          </tr>
          <tr>
            <td>仅 AI 声称被系统证伪</td>
            <td>{h.claimsRefuted} 次</td>
          </tr>
          <tr>
            <td>已验收功能被破坏、合并前被全量回归发现</td>
            <td>{h.regressionsCaught} 次</td>
          </tr>
          <tr>
            <td>运行被判无效（运行期间代码变了）</td>
            <td>
              {h.runs.invalid}/{h.runs.total}
            </td>
          </tr>
          <tr>
            <td>结果不稳定的检查结果</td>
            <td>{h.flakyResults} 次</td>
          </tr>
          <tr>
            <td>打开功能抽屉 / 系统地图 / 需求计划</td>
            <td>
              {h.ui.drawerOpened} / {h.ui.mapOpened} / {h.ui.plansOpened} 次
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
