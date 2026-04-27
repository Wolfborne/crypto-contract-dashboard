import type { BacktestResult } from '../types'

function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8;') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ResearchReportPanel({
  result,
  onExportMarkdown,
  onExportHtml
}: {
  result: BacktestResult | null
  onExportMarkdown: () => string
  onExportHtml: () => string
}) {
  if (!result) return null

  const assessment = result.report.machineAssessment
  const verdictClass = assessment.verdict === 'GREEN' ? 'verdict-green' : assessment.verdict === 'YELLOW' ? 'verdict-yellow' : 'verdict-red'

  return (
    <div className="card">
      <div className="panel-header">
        <h3>V7.3 正式研究报告</h3>
        <div className="hero-actions">
          <button className="ghost-btn" onClick={() => downloadFile('research-report.md', onExportMarkdown(), 'text/markdown;charset=utf-8;')}>导出 Markdown</button>
          <button className="ghost-btn" onClick={() => downloadFile('research-report.html', onExportHtml(), 'text/html;charset=utf-8;')}>导出 HTML</button>
        </div>
      </div>

      <div className="report-layout">
        <section className={`report-section verdict-card ${verdictClass}`}>
          <div className="verdict-head">
            <div className="verdict-light" />
            <div>
              <div className="muted">首页 Verdict</div>
              <h4>{assessment.verdictText}</h4>
            </div>
          </div>
          <div className="grid four calc-results" style={{ marginTop: 12 }}>
            <div><span className="muted">机器评分</span><strong>{assessment.score}/100</strong></div>
            <div><span className="muted">建议标签</span><strong>{assessment.label}</strong></div>
            <div><span className="muted">结论置信度</span><strong>{assessment.confidence}</strong></div>
            <div><span className="muted">关键担忧</span><strong>{assessment.keyConcern}</strong></div>
          </div>
          <div className="verdict-summary">
            <p><strong>一句话判断：</strong>{assessment.summaryLine}</p>
            <p><strong>下一步动作：</strong>{assessment.nextAction}</p>
          </div>
          <div className="tag-row">
            {assessment.tags.map((tag) => <span key={tag} className="report-tag">{tag}</span>)}
          </div>
        </section>

        <section className="report-section">
          <h4>2. 机器评分与理由</h4>
          <ul className="report-list">
            {assessment.rationale.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="report-section">
          <h4>3. 研究结论</h4>
          <p>{result.report.conclusion}</p>
          <p><strong>当前建议：</strong>{result.report.currentRecommendation}</p>
        </section>

        <section className="report-section">
          <h4>4. 核心指标</h4>
          <div className="grid four calc-results">
            <div><span className="muted">总交易数</span><strong>{result.summary.trades}</strong></div>
            <div><span className="muted">累计 R</span><strong>{result.summary.totalR.toFixed(2)}R</strong></div>
            <div><span className="muted">价格收益</span><strong>{result.summary.priceOnlyR.toFixed(2)}R</strong></div>
            <div><span className="muted">Funding 收益</span><strong>{result.summary.fundingR.toFixed(2)}R</strong></div>
          </div>
          <div className="grid four calc-results" style={{ marginTop: 12 }}>
            <div><span className="muted">胜率</span><strong>{result.summary.winRate.toFixed(1)}%</strong></div>
            <div><span className="muted">期望 R</span><strong>{result.summary.expectancy.toFixed(2)}</strong></div>
            <div><span className="muted">最大回撤</span><strong>{result.summary.maxDrawdownR.toFixed(2)}R</strong></div>
            <div><span className="muted">Funding 已计入</span><strong>{result.assumptions.fundingIncluded ? '是' : '否'}</strong></div>
          </div>
        </section>

        <section className="report-section">
          <h4>5. 参数与策略判断</h4>
          <ul className="report-list">
            <li><strong>最优参数组：</strong>{result.report.bestParameterSet}</li>
            <li><strong>最稳参数组：</strong>{result.report.mostStableParameterSet}</li>
            <li><strong>最强策略：</strong>{result.report.strongestStrategy}</li>
            <li><strong>最弱策略：</strong>{result.report.weakestStrategy}</li>
          </ul>
        </section>

        <section className="report-section">
          <h4>6. Walk-forward 结论</h4>
          <p>{result.report.walkForwardTakeaway}</p>
          <table>
            <thead>
              <tr>
                <th>窗口</th>
                <th>训练区间</th>
                <th>测试区间</th>
                <th>参数</th>
                <th>价格 R</th>
                <th>Funding R</th>
                <th>测试 R</th>
              </tr>
            </thead>
            <tbody>
              {result.walkForward.windows.map((row) => (
                <tr key={row.windowIndex}>
                  <td>#{row.windowIndex}</td>
                  <td>{row.trainStart} ~ {row.trainEnd}</td>
                  <td>{row.testStart} ~ {row.testEnd}</td>
                  <td>{row.bestParams.oversoldThreshold}/{row.bestParams.trendThreshold}/{row.bestParams.holdBars}</td>
                  <td className={row.testPriceOnlyR >= 0 ? 'pos' : 'neg'}>{row.testPriceOnlyR.toFixed(2)}R</td>
                  <td className={row.testFundingR >= 0 ? 'pos' : 'neg'}>{row.testFundingR.toFixed(2)}R</td>
                  <td className={row.testTotalR >= 0 ? 'pos' : 'neg'}>{row.testTotalR.toFixed(2)}R</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="report-section">
          <h4>7. Funding 分析</h4>
          <p>{result.report.fundingTakeaway}</p>
          <table>
            <thead>
              <tr>
                <th>策略</th>
                <th>价格 R</th>
                <th>Funding R</th>
                <th>累计 R</th>
              </tr>
            </thead>
            <tbody>
              {result.byStrategy.map((row) => (
                <tr key={row.strategy}>
                  <td>{row.strategy}</td>
                  <td className={row.priceOnlyR >= 0 ? 'pos' : 'neg'}>{row.priceOnlyR.toFixed(2)}R</td>
                  <td className={row.fundingR >= 0 ? 'pos' : 'neg'}>{row.fundingR.toFixed(2)}R</td>
                  <td className={row.totalR >= 0 ? 'pos' : 'neg'}>{row.totalR.toFixed(2)}R</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="report-section">
          <h4>8. 风险提示</h4>
          <ul className="report-list">
            {result.report.riskNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      </div>
    </div>
  )
}
