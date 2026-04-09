import { useEffect, useMemo, useState } from 'react'

export function PositionCalculator({ defaultRiskPct = 0.5, defaultLeverage = 3 }: { defaultRiskPct?: number; defaultLeverage?: number }) {
  const [equity, setEquity] = useState(10000)
  const [riskPct, setRiskPct] = useState(defaultRiskPct)
  const [entry, setEntry] = useState(65000)
  const [stop, setStop] = useState(63000)
  const [leverage, setLeverage] = useState(defaultLeverage)

  useEffect(() => setRiskPct(defaultRiskPct), [defaultRiskPct])
  useEffect(() => setLeverage(defaultLeverage), [defaultLeverage])

  const result = useMemo(() => {
    const riskAmount = equity * (riskPct / 100)
    const stopDistancePct = Math.abs((entry - stop) / entry)
    const notional = stopDistancePct === 0 ? 0 : riskAmount / stopDistancePct
    const margin = leverage === 0 ? 0 : notional / leverage
    const rr1 = stopDistancePct === 0 ? 0 : ((entry * 1.05 - entry) / entry) / stopDistancePct
    return { riskAmount, stopDistancePct, notional, margin, rr1 }
  }, [equity, riskPct, entry, stop, leverage])

  return (
    <div className="card">
      <h3>仓位计算器</h3>
      <div className="grid two">
        <label>账户净值<input type="number" value={equity} onChange={(e) => setEquity(Number(e.target.value))} /></label>
        <label>单笔风险 %<input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} /></label>
        <label>入场价<input type="number" value={entry} onChange={(e) => setEntry(Number(e.target.value))} /></label>
        <label>止损价<input type="number" value={stop} onChange={(e) => setStop(Number(e.target.value))} /></label>
        <label>杠杆<input type="number" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} /></label>
      </div>
      <div className="grid four calc-results">
        <div><span className="muted">最大亏损</span><strong>{result.riskAmount.toFixed(2)}</strong></div>
        <div><span className="muted">止损幅度</span><strong>{(result.stopDistancePct * 100).toFixed(2)}%</strong></div>
        <div><span className="muted">名义仓位</span><strong>{result.notional.toFixed(2)}</strong></div>
        <div><span className="muted">保证金占用</span><strong>{result.margin.toFixed(2)}</strong></div>
      </div>
      <p className="muted">示例 RR（按 +5% 目标粗算）：{result.rr1.toFixed(2)}R</p>
    </div>
  )
}
