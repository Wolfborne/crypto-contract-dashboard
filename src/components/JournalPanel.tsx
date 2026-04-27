import { useMemo, useState } from 'react'
import type { EnvironmentType, StrategyType, TradeJournalEntry } from '../types'

const strategies: StrategyType[] = ['均值回归', '轮动跟随', '错价修复候选']
const environments: EnvironmentType[] = ['恐慌/超卖', '趋势/牛市', '震荡', '极端事件候选']

export function JournalPanel({
  entries,
  onAdd
}: {
  entries: TradeJournalEntry[]
  onAdd: (entry: TradeJournalEntry) => void
}) {
  const [symbol, setSymbol] = useState('BTC')
  const [strategy, setStrategy] = useState<StrategyType>('均值回归')
  const [environment, setEnvironment] = useState<EnvironmentType>('震荡')
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG')
  const [thesis, setThesis] = useState('')
  const [entryPrice, setEntryPrice] = useState(0)
  const [stopPrice, setStopPrice] = useState(0)
  const [exitPrice, setExitPrice] = useState(0)
  const [note, setNote] = useState('')

  const stats = useMemo(() => {
    const total = entries.length
    const wins = entries.filter((e) => e.resultR > 0).length
    const avgR = total ? entries.reduce((sum, e) => sum + e.resultR, 0) / total : 0
    const totalR = entries.reduce((sum, e) => sum + e.resultR, 0)
    return { total, wins, winRate: total ? (wins / total) * 100 : 0, avgR, totalR }
  }, [entries])

  function addEntry() {
    if (!symbol || !thesis || !entryPrice || !stopPrice || !exitPrice) return
    const riskPerUnit = Math.abs(entryPrice - stopPrice)
    const pnlPerUnit = side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice
    const resultR = riskPerUnit === 0 ? 0 : pnlPerUnit / riskPerUnit

    onAdd({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      symbol,
      strategy,
      environment,
      side,
      thesis,
      entryPrice,
      stopPrice,
      exitPrice,
      resultR,
      note
    })

    setThesis('')
    setEntryPrice(0)
    setStopPrice(0)
    setExitPrice(0)
    setNote('')
  }

  return (
    <div className="card">
      <h3>交易日志 / 复盘</h3>
      <div className="grid four calc-results">
        <div><span className="muted">总笔数</span><strong>{stats.total}</strong></div>
        <div><span className="muted">胜率</span><strong>{stats.winRate.toFixed(1)}%</strong></div>
        <div><span className="muted">平均 R</span><strong>{stats.avgR.toFixed(2)}</strong></div>
        <div><span className="muted">累计 R</span><strong>{stats.totalR.toFixed(2)}R</strong></div>
      </div>

      <div className="grid two journal-form">
        <label>标的<input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
        <label>方向
          <select value={side} onChange={(e) => setSide(e.target.value as 'LONG' | 'SHORT')}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label>策略
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyType)}>
            {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>环境
          <select value={environment} onChange={(e) => setEnvironment(e.target.value as EnvironmentType)}>
            {environments.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>入场价<input type="number" value={entryPrice} onChange={(e) => setEntryPrice(Number(e.target.value))} /></label>
        <label>止损价<input type="number" value={stopPrice} onChange={(e) => setStopPrice(Number(e.target.value))} /></label>
        <label>出场价<input type="number" value={exitPrice} onChange={(e) => setExitPrice(Number(e.target.value))} /></label>
        <label>交易 thesis<input value={thesis} onChange={(e) => setThesis(e.target.value)} /></label>
      </div>
      <label>备注<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></label>
      <button className="primary-btn" onClick={addEntry}>记录交易</button>

      <div className="journal-table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>标的</th>
              <th>方向</th>
              <th>策略</th>
              <th>环境</th>
              <th>R</th>
              <th>Thesis</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                <td>{e.symbol}</td>
                <td>{e.side}</td>
                <td>{e.strategy}</td>
                <td>{e.environment}</td>
                <td className={e.resultR >= 0 ? 'pos' : 'neg'}>{e.resultR.toFixed(2)}R</td>
                <td>{e.thesis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
