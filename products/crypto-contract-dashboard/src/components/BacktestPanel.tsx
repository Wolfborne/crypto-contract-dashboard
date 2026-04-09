import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from 'recharts'
import type { BacktestResult, ParameterScanRow } from '../types'

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function BacktestPanel({
  result,
  loading,
  onRun,
  onExportScan,
  onExportStrategy,
  onExportWalkForward
}: {
  result: BacktestResult | null
  loading: boolean
  onRun: () => void
  onExportScan: () => string
  onExportStrategy: () => string
  onExportWalkForward: () => string
}) {
  return (
    <div className="card">
      <div className="panel-header">
        <h3>V8.4-b Phase 7：regime-aware 风控参数切换</h3>
        <div className="hero-actions">
          <button className="ghost-btn" onClick={onRun}>{loading ? '回测中...' : '运行回测'}</button>
          <button className="ghost-btn" onClick={() => downloadText('parameter-scan.csv', onExportScan())}>导出参数扫描</button>
          <button className="ghost-btn" onClick={() => downloadText('strategy-breakdown.csv', onExportStrategy())}>导出策略拆分</button>
          <button className="ghost-btn" onClick={() => downloadText('walk-forward.csv', onExportWalkForward())}>导出 Walk-forward</button>
        </div>
      </div>
      <p className="muted">这一版把固定风控阈值升级成 regime-aware profiles：趋势、弱势、恐慌、震荡会切换不同的持仓数、exposure 上限、risk-off 阈值和日/周损失限制。</p>
      {result ? (
        <>
          <div className="grid four calc-results">
            <div><span className="muted">总交易数</span><strong>{result.summary.trades}</strong></div>
            <div><span className="muted">胜率</span><strong>{result.summary.winRate.toFixed(1)}%</strong></div>
            <div><span className="muted">平均 / 期望 R</span><strong>{result.summary.expectancy.toFixed(2)}</strong></div>
            <div><span className="muted">累计 R</span><strong>{result.summary.totalR.toFixed(2)}R</strong></div>
          </div>
          <div className="grid four calc-results backtest-stats-row">
            <div><span className="muted">价格收益</span><strong>{result.summary.priceOnlyR.toFixed(2)}R</strong></div>
            <div><span className="muted">Funding 收益</span><strong>{result.summary.fundingR.toFixed(2)}R</strong></div>
            <div><span className="muted">最大回撤</span><strong>{result.summary.maxDrawdownR.toFixed(2)}R</strong></div>
            <div><span className="muted">建模模式</span><strong>{result.assumptions.intrabarMode === 'conservative' ? '保守 intrabar' : result.assumptions.intrabarMode}</strong></div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h4>{result.report.title}</h4>
            <p>{result.report.conclusion}</p>
            <div className="grid two">
              <div>
                <div><span className="muted">最强策略：</span><strong>{result.report.strongestStrategy}</strong></div>
                <div><span className="muted">最弱策略：</span><strong>{result.report.weakestStrategy}</strong></div>
                <div><span className="muted">最优参数：</span><strong>{result.report.bestParameterSet}</strong></div>
                <div><span className="muted">最稳参数：</span><strong>{result.report.mostStableParameterSet}</strong></div>
              </div>
              <div>
                <div><span className="muted">Walk-forward 摘要：</span><strong>{result.report.walkForwardTakeaway}</strong></div>
                <div style={{ marginTop: 8 }}><span className="muted">Funding 摘要：</span><strong>{result.report.fundingTakeaway}</strong></div>
                <div style={{ marginTop: 8 }}><span className="muted">当前建议：</span>{result.report.currentRecommendation}</div>
              </div>
            </div>
            <ul>
              {result.report.riskNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>

          <div className="grid four calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">Funding 计入</span><strong>{result.assumptions.fundingIncluded ? '是' : '否'}</strong></div>
            <div><span className="muted">分批止盈</span><strong>{result.assumptions.partialTakeProfit ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">ATR trailing</span><strong>{result.assumptions.dynamicTrailingStop ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">时间退出</span><strong>{result.assumptions.timeExitEnabled ? '启用' : '关闭'}</strong></div>
          </div>
          <div className="grid four calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">失效退出</span><strong>{result.assumptions.invalidationExitEnabled ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">策略风险预算</span><strong>{result.assumptions.strategyRiskBudgetEnabled ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">连亏风险收缩</span><strong>{result.assumptions.lossStreakThrottleEnabled ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">日损失限制</span><strong>{result.assumptions.dailyLossLimitEnabled ? '启用' : '关闭'}</strong></div>
          </div>

          <div className="grid four calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">周损失限制</span><strong>{result.assumptions.weeklyLossLimitEnabled ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">Regime 风控</span><strong>{result.assumptions.regimeAwareRiskEnabled ? '启用' : '关闭'}</strong></div>
            <div><span className="muted">建模层级</span><strong>V8.4-b P7</strong></div>
            <div><span className="muted">默认持有 bars</span><strong>{result.assumptions.holdBars}</strong></div>
          </div>

          <div className="grid two">
            <div className="chart-card">
              <h4>权益曲线（R）</h4>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={result.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#243244" />
                  <XAxis dataKey="index" stroke="#a7b4c2" />
                  <YAxis stroke="#a7b4c2" />
                  <Tooltip />
                  <Area type="monotone" dataKey="equityR" stroke="#7cd4ff" fill="#1f8fff33" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <h4>月度累计 R</h4>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={result.monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#243244" />
                  <XAxis dataKey="month" stroke="#a7b4c2" />
                  <YAxis stroke="#a7b4c2" />
                  <Tooltip />
                  <Bar dataKey="totalR" fill="#5cc8ff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid two">
            <div>
              <h4>Walk-forward 样本外摘要</h4>
              <div className="grid four calc-results" style={{ marginBottom: 12 }}>
                <div><span className="muted">窗口数</span><strong>{result.walkForward.summary.windows}</strong></div>
                <div><span className="muted">OOS 胜率</span><strong>{result.walkForward.summary.winRate.toFixed(1)}%</strong></div>
                <div><span className="muted">OOS 价格收益</span><strong>{result.walkForward.summary.priceOnlyR.toFixed(2)}R</strong></div>
                <div><span className="muted">OOS Funding</span><strong>{result.walkForward.summary.fundingR.toFixed(2)}R</strong></div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>窗口</th>
                    <th>训练区间</th>
                    <th>测试区间</th>
                    <th>参数</th>
                    <th>测试数</th>
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
                      <td>{row.testTrades}</td>
                      <td className={row.testPriceOnlyR >= 0 ? 'pos' : 'neg'}>{row.testPriceOnlyR.toFixed(2)}R</td>
                      <td className={row.testFundingR >= 0 ? 'pos' : 'neg'}>{row.testFundingR.toFixed(2)}R</td>
                      <td className={row.testTotalR >= 0 ? 'pos' : 'neg'}>{row.testTotalR.toFixed(2)}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4>参数扫描 Top 10</h4>
              <table>
                <thead>
                  <tr>
                    <th>超卖阈值</th>
                    <th>趋势阈值</th>
                    <th>持有</th>
                    <th>交易数</th>
                    <th>总 R</th>
                    <th>收益/回撤</th>
                    <th>期望</th>
                  </tr>
                </thead>
                <tbody>
                  {result.parameterScan.slice(0, 10).map((row: ParameterScanRow, idx) => (
                    <tr key={`${row.oversoldThreshold}-${row.trendThreshold}-${row.holdBars}-${idx}`}>
                      <td>{row.oversoldThreshold}</td>
                      <td>{row.trendThreshold}</td>
                      <td>{row.holdBars}</td>
                      <td>{row.trades}</td>
                      <td className={row.totalR >= 0 ? 'pos' : 'neg'}>{row.totalR.toFixed(2)}R</td>
                      <td>{row.scoreProfitDrawdown.toFixed(2)}</td>
                      <td>{row.scoreExpectancy.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid two">
            <div>
              <h4>按策略拆分</h4>
              <table>
                <thead>
                  <tr>
                    <th>策略</th>
                    <th>交易数</th>
                    <th>价格 R</th>
                    <th>Funding R</th>
                    <th>累计 R</th>
                    <th>最大回撤</th>
                  </tr>
                </thead>
                <tbody>
                  {result.byStrategy.map((row) => (
                    <tr key={row.strategy}>
                      <td>{row.strategy}</td>
                      <td>{row.trades}</td>
                      <td className={row.priceOnlyR >= 0 ? 'pos' : 'neg'}>{row.priceOnlyR.toFixed(2)}R</td>
                      <td className={row.fundingR >= 0 ? 'pos' : 'neg'}>{row.fundingR.toFixed(2)}R</td>
                      <td className={row.totalR >= 0 ? 'pos' : 'neg'}>{row.totalR.toFixed(2)}R</td>
                      <td>{row.maxDrawdownR.toFixed(2)}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4>按标的拆分</h4>
              <table>
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>交易数</th>
                    <th>价格 R</th>
                    <th>Funding R</th>
                    <th>累计 R</th>
                    <th>最大回撤</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bySymbol.map((row) => (
                    <tr key={row.symbol}>
                      <td>{row.symbol}</td>
                      <td>{row.trades}</td>
                      <td className={row.priceOnlyR >= 0 ? 'pos' : 'neg'}>{row.priceOnlyR.toFixed(2)}R</td>
                      <td className={row.fundingR >= 0 ? 'pos' : 'neg'}>{row.fundingR.toFixed(2)}R</td>
                      <td className={row.totalR >= 0 ? 'pos' : 'neg'}>{row.totalR.toFixed(2)}R</td>
                      <td className={row.maxDrawdownR <= 3 ? 'pos' : 'neg'}>{row.maxDrawdownR.toFixed(2)}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
