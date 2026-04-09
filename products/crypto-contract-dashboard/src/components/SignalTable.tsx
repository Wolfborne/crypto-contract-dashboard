import { useMemo, useState } from 'react'
import type { DashboardSignal, ExecutionStatus, PaperGatePreview, ReadinessEvaluation } from '../types'

type GateFilter = 'ALL' | 'ALLOW' | 'RISK_OFF' | 'BLOCKED'
type GateSort = 'PRIORITY_DESC' | 'GATE_DESC' | 'SCORE_DESC' | 'SYMBOL_ASC'

function gateRank(verdict?: PaperGatePreview['verdict']) {
  if (verdict === 'ALLOW') return 3
  if (verdict === 'RISK_OFF') return 2
  if (verdict === 'BLOCKED') return 1
  return 0
}

function executionStatusClass(status?: PaperGatePreview['executionStatus']) {
  if (status === 'ALLOW_FULL') return 'pos'
  if (status === 'ALLOW_CAPPED' || status === 'RISK_OFF' || status === 'RISK_OFF_CAPPED') return 'muted'
  return 'neg'
}

export function SignalTable({ signals, gatePreviews, readinessEvaluations, highlightedExecutionStatus, highlightedMatchReason, onClearExecutionStatus, onClearMatchReason, onAddPaperTrade, onOpenReadinessDetail }: { signals: DashboardSignal[]; gatePreviews?: Record<string, PaperGatePreview>; readinessEvaluations?: Record<string, ReadinessEvaluation>; highlightedExecutionStatus?: 'ALL' | ExecutionStatus; highlightedMatchReason?: 'ALL' | string; onClearExecutionStatus?: () => void; onClearMatchReason?: () => void; onAddPaperTrade?: (signal: DashboardSignal) => void; onOpenReadinessDetail?: (symbol: string) => void }) {
  const [filter, setFilter] = useState<GateFilter>('ALL')
  const [sortBy, setSortBy] = useState<GateSort>('PRIORITY_DESC')

  const visibleSignals = useMemo(() => {
    const filtered = signals.filter((signal) => {
      const verdict = gatePreviews?.[signal.symbol]?.verdict
      if (filter === 'ALL') return true
      return verdict === filter
    })

    return [...filtered].sort((a, b) => {
      const gateA = gatePreviews?.[a.symbol]
      const gateB = gatePreviews?.[b.symbol]
      if (sortBy === 'SCORE_DESC') return b.score - a.score
      if (sortBy === 'SYMBOL_ASC') return a.symbol.localeCompare(b.symbol)
      if (sortBy === 'PRIORITY_DESC') {
        const priorityDiff = (gateB?.priorityScore ?? -999) - (gateA?.priorityScore ?? -999)
        if (priorityDiff !== 0) return priorityDiff
      }
      const gateDiff = gateRank(gateB?.verdict) - gateRank(gateA?.verdict)
      if (gateDiff !== 0) return gateDiff
      return b.score - a.score
    })
  }, [signals, gatePreviews, filter, sortBy])

  return (
    <div className="card">
      {(highlightedExecutionStatus !== 'ALL' && highlightedExecutionStatus) || (highlightedMatchReason !== 'ALL' && highlightedMatchReason) ? (
        <div className="drilldown-chipbar global-drilldown-chipbar" style={{ marginBottom: 12 }}>
          <span className="muted">V11.9 Global Drill-down</span>
          {highlightedExecutionStatus !== 'ALL' && highlightedExecutionStatus ? <button className="drilldown-chip" onClick={onClearExecutionStatus}>status: {highlightedExecutionStatus} ×</button> : null}
          {highlightedMatchReason !== 'ALL' && highlightedMatchReason ? <button className="drilldown-chip" onClick={onClearMatchReason}>reason: {highlightedMatchReason} ×</button> : null}
          <span className="muted">{highlightedExecutionStatus !== 'ALL' && highlightedMatchReason !== 'ALL' ? '当前为 status + reason 交集' : highlightedExecutionStatus !== 'ALL' ? '当前只按 status' : '当前只按 reason'}</span>
        </div>
      ) : null}
      <div className="panel-header" style={{ marginBottom: 12 }}>
        <h3>策略候选</h3>
        <div className="signal-toolbar">
          <label>
            <span className="muted">Gate 过滤</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value as GateFilter)}>
              <option value="ALL">全部</option>
              <option value="ALLOW">只看 ALLOW</option>
              <option value="RISK_OFF">只看 RISK_OFF</option>
              <option value="BLOCKED">只看 BLOCKED</option>
            </select>
          </label>
          <label>
            <span className="muted">排序</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as GateSort)}>
              <option value="PRIORITY_DESC">按执行优先级分数</option>
              <option value="GATE_DESC">按 Gate 优先级</option>
              <option value="SCORE_DESC">按评分</option>
              <option value="SYMBOL_ASC">按标的</option>
            </select>
          </label>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>标的</th>
            <th>环境</th>
            <th>策略</th>
            <th>评分</th>
            <th>入场</th>
            <th>止损</th>
            <th>TP1</th>
            <th>TP2</th>
            <th>备注</th>
            <th>执行优先级</th>
            <th>Gate</th>
            <th>Readiness</th>
            <th>Paper</th>
          </tr>
        </thead>
        <tbody>
          {visibleSignals.map((s) => {
            const preview = gatePreviews?.[s.symbol]
            const readiness = readinessEvaluations?.[s.symbol]
            const readinessReason = readiness?.hardBlockReasons?.[0] ?? readiness?.softBlockReasons?.[0] ?? readiness?.fullReadyChecks?.find((item) => !item.passed)?.message ?? readiness?.trialReadyChecks?.find((item) => !item.passed)?.message ?? 'ready'
            return (
              <tr key={s.symbol} className={(highlightedExecutionStatus !== 'ALL' && highlightedExecutionStatus && preview?.executionStatus === highlightedExecutionStatus) || (highlightedMatchReason !== 'ALL' && highlightedMatchReason && preview?.matchReason === highlightedMatchReason) ? 'logic-highlight-row' : ''}>
                <td>{s.symbol}</td>
                <td>{s.environment}</td>
                <td>{s.strategy}</td>
                <td>{s.score}</td>
                <td>{s.entry}</td>
                <td>{s.stopLoss}</td>
                <td>{s.takeProfit1}</td>
                <td>{s.takeProfit2}</td>
                <td>
                  <div>{s.note}</div>
                  {(highlightedExecutionStatus !== 'ALL' && highlightedExecutionStatus && preview?.executionStatus === highlightedExecutionStatus) || (highlightedMatchReason !== 'ALL' && highlightedMatchReason && preview?.matchReason === highlightedMatchReason) ? <div className="match-reason-tag compact">{preview.matchReason}</div> : null}
                </td>
                <td>
                  {preview ? (
                    <div>
                      <strong>{preview.priorityScore.toFixed(2)}</strong>
                      <div className="muted">Gate + Score + Env</div>
                    </div>
                  ) : <span className="muted">-</span>}
                </td>
                <td>
                  {preview ? (
                    <div>
                      <div className={executionStatusClass(preview.executionStatus)}><strong>{preview.label}</strong></div>
                      <div className="muted">{preview.detail}</div>
                    </div>
                  ) : <span className="muted">-</span>}
                </td>
                <td>
                  {readiness ? (
                    <div>
                      <div className="tag-row">
                        <div className={`readiness-chip readiness-${readiness.finalDecision.toLowerCase()}`}><strong>{readiness.finalDecision}</strong></div>
                        {onOpenReadinessDetail ? <button className="ghost-btn small-btn" onClick={() => onOpenReadinessDetail(s.symbol)}>详情</button> : null}
                      </div>
                      <div className="muted">{readinessReason}</div>
                    </div>
                  ) : <span className="muted">-</span>}
                </td>
                <td>
                  {onAddPaperTrade ? <button className="ghost-btn small-btn" onClick={() => onAddPaperTrade(s)}>加入</button> : null}
                </td>
              </tr>
            )
          })}
          {!visibleSignals.length ? (
            <tr>
              <td colSpan={13} className="muted">当前过滤条件下没有候选信号。</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
