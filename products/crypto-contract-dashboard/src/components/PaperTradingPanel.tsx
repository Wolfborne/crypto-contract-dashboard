import { useMemo, useState } from 'react'
import type { DashboardSignal, EnvironmentType, ExecutionStatus, ExecutionStatusStat, MatchReasonStat, PaperEquityPoint, PaperGateSummary, PaperTrade, ReadinessRuntimeState, StrategyType, ValidationStatsMap } from '../types'

function fmt(value?: number, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-'
}

function pct(used: number, limit: number) {
  if (!limit) return '-'
  return `${((used / limit) * 100).toFixed(0)}%`
}

function daysDiffFromNow(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
}

function toggleStatus(current: 'ALL' | ExecutionStatus, next: ExecutionStatus) {
  return current === next ? 'ALL' : next
}

function toggleReason(current: 'ALL' | string, next: string) {
  return current === next ? 'ALL' : next
}

function buildExecutionStats(trades: PaperTrade[]): ExecutionStatusStat[] {
  const order: NonNullable<PaperTrade['executionStatus']>[] = ['ALLOW_FULL', 'ALLOW_CAPPED', 'RISK_OFF', 'RISK_OFF_CAPPED', 'BLOCKED_GATE', 'BLOCKED_BUDGET']
  return order.map((status) => {
    const subset = trades.filter((trade) => trade.executionStatus === status)
    const closed = subset.filter((trade) => trade.status === 'CLOSED')
    const wins = closed.filter((trade) => (trade.realizedPnl ?? 0) > 0).length
    return {
      status,
      total: subset.length,
      open: subset.filter((trade) => trade.status === 'OPEN').length,
      closed: closed.length,
      blocked: subset.filter((trade) => trade.status === 'BLOCKED').length,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      realizedPnl: closed.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
    }
  }).filter((item) => item.total > 0)
}

function buildMatchReasonStats(trades: PaperTrade[]): MatchReasonStat[] {
  return Array.from(new Set(trades.map((trade) => trade.matchReason).filter((value): value is string => Boolean(value)))).map((reason) => {
    const subset = trades.filter((trade) => trade.matchReason === reason)
    const closed = subset.filter((trade) => trade.status === 'CLOSED')
    const wins = closed.filter((trade) => (trade.realizedPnl ?? 0) > 0).length
    return {
      reason,
      total: subset.length,
      open: subset.filter((trade) => trade.status === 'OPEN').length,
      closed: closed.length,
      blocked: subset.filter((trade) => trade.status === 'BLOCKED').length,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      realizedPnl: closed.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
    }
  }).sort((a, b) => b.total - a.total || b.realizedPnl - a.realizedPnl)
}

export function PaperTradingPanel({
  topSignal,
  trades,
  equityCurve,
  gateSummary,
  executionStats,
  readinessRuntimeState,
  validationStatsBySetup,
  onSelectExecutionStatus,
  onSelectMatchReason,
  onAddTrade,
  onUpdateStatus
}: {
  topSignal: DashboardSignal | undefined
  trades: PaperTrade[]
  equityCurve: PaperEquityPoint[]
  gateSummary: PaperGateSummary
  executionStats: ExecutionStatusStat[]
  readinessRuntimeState: ReadinessRuntimeState
  validationStatsBySetup: ValidationStatsMap
  onSelectExecutionStatus?: (status: 'ALL' | ExecutionStatus) => void
  onSelectMatchReason?: (reason: 'ALL' | string) => void
  onAddTrade: (signal: DashboardSignal) => void
  onUpdateStatus: (id: string, status: PaperTrade['status']) => void
}) {
  const [timeFilter, setTimeFilter] = useState<'ALL' | '7D' | '30D'>('ALL')
  const [environmentFilter, setEnvironmentFilter] = useState<'ALL' | EnvironmentType>('ALL')
  const [strategyFilter, setStrategyFilter] = useState<'ALL' | StrategyType>('ALL')
  const [matchReasonFilter, setMatchReasonFilter] = useState<'ALL' | string>('ALL')
  const [selectedExecutionStatus, setSelectedExecutionStatus] = useState<'ALL' | ExecutionStatus>('ALL')

  function handleSelectExecutionStatus(status: 'ALL' | ExecutionStatus) {
    setSelectedExecutionStatus(status)
    onSelectExecutionStatus?.(status)
  }

  function handleSelectMatchReason(reason: 'ALL' | string) {
    setMatchReasonFilter(reason)
    onSelectMatchReason?.(reason)
  }

  const availableMatchReasons = useMemo(() => Array.from(new Set(trades.map((trade) => trade.matchReason).filter((value): value is string => Boolean(value)))).sort(), [trades])

  const filteredExecutionTrades = useMemo(() => trades.filter((trade) => {
    if (timeFilter === '7D' && daysDiffFromNow(trade.createdAt) > 7) return false
    if (timeFilter === '30D' && daysDiffFromNow(trade.createdAt) > 30) return false
    if (environmentFilter !== 'ALL' && trade.environment !== environmentFilter) return false
    if (strategyFilter !== 'ALL' && trade.strategy !== strategyFilter) return false
    if (matchReasonFilter !== 'ALL' && trade.matchReason !== matchReasonFilter) return false
    if (selectedExecutionStatus !== 'ALL' && trade.executionStatus !== selectedExecutionStatus) return false
    return true
  }), [trades, timeFilter, environmentFilter, strategyFilter, matchReasonFilter, selectedExecutionStatus])

  const filteredExecutionStats = useMemo(() => buildExecutionStats(filteredExecutionTrades), [filteredExecutionTrades])
  const filteredMatchReasonStats = useMemo(() => buildMatchReasonStats(filteredExecutionTrades), [filteredExecutionTrades])

  const openTrades = trades.filter((trade) => trade.status === 'OPEN')
  const closedTrades = trades.filter((trade) => trade.status === 'CLOSED')
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
  const unrealizedPnl = openTrades.reduce((sum, trade) => sum + (trade.unrealizedPnl ?? 0), 0)
  const activeDowngrades = useMemo(() => Object.values(readinessRuntimeState.setups ?? {}).filter((item) => item.forcedMaxDecision || item.cooldownRemainingTrades > 0), [readinessRuntimeState])
  const topValidationSetups = useMemo(() => Object.values(validationStatsBySetup).sort((a, b) => b.sampleCount - a.sampleCount).slice(0, 8), [validationStatsBySetup])
  const winRate = closedTrades.length
    ? (closedTrades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length / closedTrades.length) * 100
    : 0

  return (
    <div className="card">
      <div className="panel-header">
        <h3>V9.4：Paper Gate Console</h3>
      </div>

      <div className="report-section" style={{ marginBottom: 16 }}>
        <h4>Gate 状态总览</h4>
        <div className="grid four calc-results">
          <div><span className="muted">当前 Regime</span><strong>{gateSummary.regime}</strong></div>
          <div><span className="muted">Risk Mode</span><strong className={gateSummary.riskMode === 'NORMAL' ? 'pos' : 'neg'}>{gateSummary.riskMode}</strong></div>
          <div><span className="muted">Open Positions</span><strong>{gateSummary.openPositions} / {gateSummary.maxOpenPositions}</strong></div>
          <div><span className="muted">最新 Gate</span><strong>{gateSummary.lastDecision ?? '-'}</strong></div>
        </div>
        <div className="grid four calc-results" style={{ marginTop: 12 }}>
          <div><span className="muted">当前净值</span><strong>{fmt(gateSummary.currentEquity)}</strong></div>
          <div><span className="muted">峰值净值</span><strong>{fmt(gateSummary.peakEquity)}</strong></div>
          <div><span className="muted">Drawdown</span><strong>{fmt(gateSummary.drawdown)} / {fmt(gateSummary.drawdownRiskOffTrigger)} / {fmt(gateSummary.drawdownHardStopTrigger)}</strong></div>
          <div><span className="muted">Day / Week PnL</span><strong>{fmt(gateSummary.todayPnl)} / {fmt(gateSummary.weekPnl)}</strong></div>
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div className="report-section">
            <h4>Exposure 使用率</h4>
            <div className="grid two calc-results">
              <div><span className="muted">LONG</span><strong>{fmt(gateSummary.exposures.long.used)} / {fmt(gateSummary.exposures.long.limit)} ({pct(gateSummary.exposures.long.used, gateSummary.exposures.long.limit)})</strong></div>
              <div><span className="muted">SHORT</span><strong>{fmt(gateSummary.exposures.short.used)} / {fmt(gateSummary.exposures.short.limit)} ({pct(gateSummary.exposures.short.used, gateSummary.exposures.short.limit)})</strong></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="muted">Strategy</div>
              {gateSummary.exposures.strategies.length ? gateSummary.exposures.strategies.map((item) => <div key={item.key}>{item.key}: {fmt(item.used)} / {fmt(item.limit)} ({pct(item.used, item.limit)})</div>) : <div className="muted">暂无策略占用</div>}
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="muted">Sector-Side</div>
              {gateSummary.exposures.sectors.length ? gateSummary.exposures.sectors.map((item) => <div key={item.key}>{item.key}: {fmt(item.used)} / {fmt(item.limit)} ({pct(item.used, item.limit)})</div>) : <div className="muted">暂无赛道占用</div>}
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="muted">Beta Bucket</div>
              {gateSummary.exposures.betaBuckets.length ? gateSummary.exposures.betaBuckets.map((item) => <div key={item.key}>{item.key}: {fmt(item.used)} / {fmt(item.limit)} ({pct(item.used, item.limit)})</div>) : <div className="muted">暂无 beta bucket 占用</div>}
            </div>
          </div>
          <div className="report-section">
            <h4>Loss Budget</h4>
            <div className="grid two calc-results">
              <div><span className="muted">今日损益 / 限制</span><strong>{fmt(gateSummary.todayPnl)} / {fmt(gateSummary.dailyLossLimit)}</strong></div>
              <div><span className="muted">本周损益 / 限制</span><strong>{fmt(gateSummary.weekPnl)} / {fmt(gateSummary.weeklyLossLimit)}</strong></div>
            </div>
            <div style={{ marginTop: 12 }} className="muted">
              读法：
              <div>• Drawdown 三元组 = 当前回撤 / risk-off 阈值 / hard-stop 阈值</div>
              <div>• Exposure 显示 used / limit / 使用率</div>
              <div>• 最新 Gate 显示最近一次 paper add 的放行或拦截原因</div>
            </div>
          </div>
        </div>
      </div>

      {topSignal ? (
        <div className="report-section" style={{ marginBottom: 16 }}>
          <h4>实时信号卡</h4>
          <div className="grid four calc-results">
            <div><span className="muted">标的</span><strong>{topSignal.symbol}</strong></div>
            <div><span className="muted">环境</span><strong>{topSignal.environment}</strong></div>
            <div><span className="muted">策略</span><strong>{topSignal.strategy}</strong></div>
            <div><span className="muted">评分</span><strong>{topSignal.score}</strong></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div><span className="muted">入场：</span>{topSignal.entry}</div>
            <div><span className="muted">止损：</span>{topSignal.stopLoss}</div>
            <div><span className="muted">TP1 / TP2：</span>{topSignal.takeProfit1} / {topSignal.takeProfit2}</div>
            <div style={{ marginTop: 8 }}><span className="muted">备注：</span>{topSignal.note}</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="ghost-btn" onClick={() => onAddTrade(topSignal)}>加入 Paper Ledger</button>
          </div>
        </div>
      ) : null}

      <div className="grid four calc-results" style={{ marginBottom: 16 }}>
        <div><span className="muted">OPEN</span><strong>{openTrades.length}</strong></div>
        <div><span className="muted">CLOSED</span><strong>{closedTrades.length}</strong></div>
        <div><span className="muted">已实现 PnL</span><strong className={realizedPnl >= 0 ? 'pos' : 'neg'}>{fmt(realizedPnl)}</strong></div>
        <div><span className="muted">未实现 PnL</span><strong className={unrealizedPnl >= 0 ? 'pos' : 'neg'}>{fmt(unrealizedPnl)}</strong></div>
      </div>

      <div className="report-section" style={{ marginBottom: 16 }}>
        <div className="panel-header" style={{ marginBottom: 12 }}>
          <h4>Readiness Downgrade / Cooldown</h4>
          <div className="muted">当前处于降级或观察期的 setup</div>
        </div>
        {activeDowngrades.length ? (
          <div className="downgrade-state-list">
            {activeDowngrades.map((item) => (
              <div key={item.setupKey} className="downgrade-state-item">
                <div><strong>{item.setupKey}</strong></div>
                <div className="tag-row" style={{ marginTop: 6 }}>
                  <div className={`readiness-chip readiness-${(item.forcedMaxDecision ?? 'paper_only').toLowerCase()}`}>{item.forcedMaxDecision ?? 'COOLDOWN'}</div>
                  <span className="muted">Cooldown {item.cooldownRemainingTrades}</span>
                  <span className="muted">LS {item.liveSmallLossStreak} / LO {item.liveOkLossStreak}</span>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>{item.lastDegradeReason ?? '-'}</div>
                <div className="muted">updatedAt: {item.updatedAt}</div>
              </div>
            ))}
          </div>
        ) : <div className="muted">当前没有 active downgrade / cooldown。</div>}
      </div>

      <div className="report-section" style={{ marginBottom: 16 }}>
        <div className="panel-header" style={{ marginBottom: 12 }}>
          <h4>Setup Validation Snapshot</h4>
          <div className="muted">最近窗口内的 setup 表现</div>
        </div>
        {topValidationSetups.length ? (
          <div className="downgrade-state-list">
            {topValidationSetups.map((item) => (
              <div key={item.setupKey} className="downgrade-state-item">
                <div><strong>{item.setupKey}</strong></div>
                <div className="muted">样本 {item.sampleCount} · Win {fmt(item.winRate)}%</div>
                <div className="muted">AvgR {fmt(item.avgResultR)} · TotalR {fmt(item.totalResultR)}</div>
                <div className="muted">DD$ {fmt(item.drawdownProxy)} · DDR {fmt(item.drawdownR)}</div>
                <div className="muted">LossStreak {item.lossStreak} / Max {item.maxLossStreak}</div>
              </div>
            ))}
          </div>
        ) : <div className="muted">暂无 setup validation 样本。</div>}
      </div>

      <div className="report-section" style={{ marginBottom: 16 }}>
        <div className="panel-header" style={{ marginBottom: 12 }}>
          <h4>V10.9：Execution Status Analytics</h4>
          <div className="analytics-toolbar">
            <label>
              <span className="muted">时间窗</span>
              <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as 'ALL' | '7D' | '30D')}>
                <option value="ALL">全部</option>
                <option value="7D">最近 7 天</option>
                <option value="30D">最近 30 天</option>
              </select>
            </label>
            <label>
              <span className="muted">环境</span>
              <select value={environmentFilter} onChange={(e) => setEnvironmentFilter(e.target.value as 'ALL' | EnvironmentType)}>
                <option value="ALL">全部</option>
                <option value="趋势/牛市">趋势/牛市</option>
                <option value="恐慌/超卖">恐慌/超卖</option>
                <option value="弱势/空头">弱势/空头</option>
                <option value="震荡">震荡</option>
                <option value="极端事件候选">极端事件候选</option>
              </select>
            </label>
            <label>
              <span className="muted">策略</span>
              <select value={strategyFilter} onChange={(e) => setStrategyFilter(e.target.value as 'ALL' | StrategyType)}>
                <option value="ALL">全部</option>
                <option value="均值回归">均值回归</option>
                <option value="轮动跟随">轮动跟随</option>
                <option value="错价修复候选">错价修复候选</option>
                <option value="趋势做空">趋势做空</option>
              </select>
            </label>
            <label>
              <span className="muted">原因</span>
              <select value={matchReasonFilter} onChange={(e) => handleSelectMatchReason(e.target.value)}>
                <option value="ALL">全部</option>
                {availableMatchReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="panel-header" style={{ marginBottom: 12 }}>
          <div className="muted">过滤后样本数：{filteredExecutionTrades.length}</div>
        </div>
        <div className="drilldown-chipbar" style={{ marginBottom: 12 }}>
          <span className="muted">V11.7 Drill-down</span>
          {selectedExecutionStatus !== 'ALL' ? <button className="drilldown-chip" onClick={() => handleSelectExecutionStatus('ALL')}>status: {selectedExecutionStatus} ×</button> : null}
          {matchReasonFilter !== 'ALL' ? <button className="drilldown-chip" onClick={() => handleSelectMatchReason('ALL')}>reason: {matchReasonFilter} ×</button> : null}
          {selectedExecutionStatus === 'ALL' && matchReasonFilter === 'ALL' ? <span className="muted">未启用</span> : <span className="muted">{selectedExecutionStatus !== 'ALL' && matchReasonFilter !== 'ALL' ? '当前查看 status + reason 交集' : selectedExecutionStatus !== 'ALL' ? '当前只按 status' : '当前只按 reason'}</span>}
        </div>
        <div className="grid four calc-results" style={{ marginBottom: 12 }}>
          {filteredExecutionStats.slice(0, 4).map((item) => (
            <button key={item.status} className={`execution-stat-card ${selectedExecutionStatus === item.status ? 'active' : ''}`} onClick={() => handleSelectExecutionStatus(toggleStatus(selectedExecutionStatus, item.status))}>
              <span className="muted">{item.status}</span>
              <strong>{item.total}</strong>
              <span className="muted">Win {fmt(item.winRate)}% · PnL {fmt(item.realizedPnl)}</span>
            </button>
          ))}
        </div>
        <div className="report-section" style={{ marginBottom: 12 }}>
          <h4>V11.4：Match Reason 聚合统计卡</h4>
          <div className="grid four calc-results">
            {filteredMatchReasonStats.slice(0, 4).map((item) => (
              <button key={item.reason} className={`match-reason-stat-card ${matchReasonFilter === item.reason ? 'active' : ''}`} onClick={() => handleSelectMatchReason(toggleReason(matchReasonFilter, item.reason))}>
                <span className="muted">{item.reason}</span>
                <strong>{item.total}</strong>
                <span className="muted">Win {fmt(item.winRate)}% · PnL {fmt(item.realizedPnl)}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {filteredMatchReasonStats.map((item) => (
              <button key={`reason-${item.reason}`} className={`execution-slice-row execution-slice-button ${matchReasonFilter === item.reason ? 'active' : ''}`} onClick={() => handleSelectMatchReason(toggleReason(matchReasonFilter, item.reason))}>
                <div><strong>{item.reason}</strong></div>
                <div className="muted">样本 {item.total}</div>
                <div className="muted">Open {item.open} / Closed {item.closed} / Blocked {item.blocked}</div>
                <div className="muted">WinRate {fmt(item.winRate)}%</div>
                <div className={item.realizedPnl >= 0 ? 'pos' : 'neg'}>Realized {fmt(item.realizedPnl)}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {filteredExecutionStats.map((item) => (
            <button key={`slice-${item.status}`} className={`execution-slice-row execution-slice-button ${selectedExecutionStatus === item.status ? 'active' : ''}`} onClick={() => handleSelectExecutionStatus(toggleStatus(selectedExecutionStatus, item.status))}>
              <div><strong>{item.status}</strong></div>
              <div className="muted">样本 {item.total}</div>
              <div className="muted">Open {item.open} / Closed {item.closed} / Blocked {item.blocked}</div>
              <div className="muted">WinRate {fmt(item.winRate)}%</div>
              <div className={item.realizedPnl >= 0 ? 'pos' : 'neg'}>Realized {fmt(item.realizedPnl)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="report-section" style={{ marginBottom: 16 }}>
        <h4>Paper Equity Curve</h4>
        <div className="grid two calc-results">
          <div><span className="muted">最新净值</span><strong>{fmt(equityCurve[equityCurve.length - 1]?.equityUsd)}</strong></div>
          <div><span className="muted">平仓胜率</span><strong>{fmt(winRate)}%</strong></div>
        </div>
        <div style={{ marginTop: 12, maxHeight: 180, overflow: 'auto', fontSize: 12 }}>
          {equityCurve.length ? equityCurve.map((point) => (
            <div key={`${point.index}-${point.label}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="muted">{point.label}</span>
              <strong>{fmt(point.equityUsd)}</strong>
            </div>
          )) : <div className="muted">暂无曲线，先加入并关闭几笔 paper trade。</div>}
        </div>
      </div>

      <div className="report-section">
        <div className="panel-header">
          <h4>Paper Trade Ledger</h4>
          <div className="muted">{selectedExecutionStatus === 'ALL' ? '显示全部 ledger 样本' : `仅显示 ${selectedExecutionStatus}`}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>标的</th>
              <th>方向</th>
              <th>入场</th>
              <th>现价</th>
              <th>出场</th>
              <th>PnL</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredExecutionTrades.length ? filteredExecutionTrades.map((trade) => {
              const pnl = trade.status === 'CLOSED' ? trade.realizedPnl : trade.unrealizedPnl
              return (
                <tr key={trade.id}>
                  <td>{new Date(trade.createdAt).toLocaleString()}</td>
                  <td>
                    <div><strong>{trade.symbol}</strong></div>
                    <div className="muted">{trade.environment} / {trade.strategy}</div>
                    <div className="muted">{trade.gateReason ?? trade.note}</div>
                    <div className="muted">{trade.matchReason ?? '-'}</div>
                    <div className="muted">Readiness: {trade.readinessDecision ?? '-'} · {trade.readinessSetupKey ?? '-'}</div>
                  </td>
                  <td>{trade.side}</td>
                  <td>{fmt(trade.entryPrice)}</td>
                  <td>{fmt(trade.currentPrice)}</td>
                  <td>
                    <div>{fmt(trade.exitPrice)}</div>
                    <div className="muted">{trade.exitReason ?? '-'}</div>
                  </td>
                  <td className={((pnl ?? 0) >= 0) ? 'pos' : 'neg'}>
                    {fmt(pnl)}
                    <div className="muted">{fmt(trade.realizedPnlPct)}%</div>
                    <div className="muted">Risk ${fmt(trade.plannedRiskUsd)}</div>
                    <div className="muted">R {fmt(trade.resultR)}</div>
                  </td>
                  <td>{trade.status}</td>
                  <td>
                    <div className="tag-row">
                      <button className="ghost-btn small-btn" onClick={() => onUpdateStatus(trade.id, 'OPEN')}>Open</button>
                      <button className="ghost-btn small-btn" onClick={() => onUpdateStatus(trade.id, 'CLOSED')}>Closed</button>
                      <button className="ghost-btn small-btn" onClick={() => onUpdateStatus(trade.id, 'BLOCKED')}>Blocked</button>
                    </div>
                  </td>
                </tr>
              )
            }) : (
              <tr>
                <td colSpan={9} className="muted">当前 drill-down / 过滤条件下没有 paper trades。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
