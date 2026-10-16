import { useState } from 'react';

/** 交付报告（§11、D26）：一页式 HTML，可另存为 PDF（环境缺 Chromium 时降级为 HTML 并注明）。 */
export function ReportPage() {
  const [version, setVersion] = useState(0);
  return (
    <div className="report-page">
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
