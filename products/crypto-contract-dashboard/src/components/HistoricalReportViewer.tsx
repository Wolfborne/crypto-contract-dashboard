import type { ResearchReportArchiveItem } from '../types'

export function HistoricalReportViewer({
  item
}: {
  item: ResearchReportArchiveItem | null
}) {
  if (!item) return null

  const verdictClass = item.verdict === 'GREEN' ? 'verdict-green' : item.verdict === 'YELLOW' ? 'verdict-yellow' : 'verdict-red'

  return (
    <div className="card">
      <div className="panel-header">
        <h3>V7.7 历史版本回看</h3>
      </div>

      <div className="report-layout">
        <section className={`report-section verdict-card ${verdictClass}`}>
          <div className="verdict-head">
            <div className="verdict-light" />
            <div>
              <div className="muted">历史版本 Verdict</div>
              <h4>{item.verdictText ?? item.verdict}</h4>
            </div>
          </div>
          <div className="grid four calc-results" style={{ marginTop: 12 }}>
            <div><span className="muted">版本</span><strong>{item.version}</strong></div>
            <div><span className="muted">评分</span><strong>{item.score}/100</strong></div>
            <div><span className="muted">置信度</span><strong>{item.confidence ?? '-'}</strong></div>
            <div><span className="muted">关键担忧</span><strong>{item.keyConcern ?? '-'}</strong></div>
          </div>
          <div className="verdict-summary">
            <p><strong>一句话判断：</strong>{item.summaryLine}</p>
            <p><strong>下一步动作：</strong>{item.nextAction ?? '-'}</p>
          </div>
        </section>

        <section className="report-section">
          <h4>核心摘要</h4>
          <div className="grid four calc-results">
            <div><span className="muted">总 R</span><strong className={item.totalR >= 0 ? 'pos' : 'neg'}>{item.totalR.toFixed(2)}R</strong></div>
            <div><span className="muted">OOS R</span><strong className={item.oosTotalR >= 0 ? 'pos' : 'neg'}>{item.oosTotalR.toFixed(2)}R</strong></div>
            <div><span className="muted">Funding R</span><strong className={item.fundingR >= 0 ? 'pos' : 'neg'}>{item.fundingR.toFixed(2)}R</strong></div>
            <div><span className="muted">最大回撤</span><strong>{item.maxDrawdownR.toFixed(2)}R</strong></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div><span className="muted">最优参数：</span><strong>{item.bestParameterSet}</strong></div>
            <div style={{ marginTop: 8 }}><span className="muted">时间：</span>{new Date(item.createdAt).toLocaleString()}</div>
            <div style={{ marginTop: 8 }}><span className="muted">备注：</span>{item.note || '无'}</div>
            <div style={{ marginTop: 8 }}><span className="muted">里程碑：</span>{item.milestone ? '是' : '否'}</div>
          </div>
        </section>
      </div>
    </div>
  )
}
