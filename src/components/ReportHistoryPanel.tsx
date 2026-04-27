import { useState } from 'react'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ResearchReportArchiveItem, ResearchReportDiff } from '../types'

export function ReportHistoryPanel({
  history,
  diff,
  onUpdateItem,
  onSelectItem,
  selectedId
}: {
  history: ResearchReportArchiveItem[]
  diff: ResearchReportDiff | null
  onUpdateItem: (id: string, patch: Partial<ResearchReportArchiveItem>) => void
  onSelectItem: (item: ResearchReportArchiveItem) => void
  selectedId?: string | null
}) {
  const latestPrevious = history[0]
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})

  const chartData = [...history].slice(0, 10).reverse().map((item, idx) => ({
    index: idx + 1,
    shortTime: new Date(item.createdAt).toLocaleDateString(),
    score: item.score,
    oosTotalR: Number(item.oosTotalR.toFixed(2)),
    fundingR: Number(item.fundingR.toFixed(2)),
    milestone: item.milestone ? 1 : 0
  }))

  const bestScoreId = history.length ? [...history].sort((a, b) => b.score - a.score)[0].id : null
  const bestOosId = history.length ? [...history].sort((a, b) => b.oosTotalR - a.oosTotalR)[0].id : null
  const mostStableId = history.length ? [...history].sort((a, b) => a.maxDrawdownR - b.maxDrawdownR)[0].id : null

  return (
    <div className="card">
      <div className="panel-header">
        <h3>V7.7 历史版本回看 / 恢复视图</h3>
      </div>

      {diff && latestPrevious ? (
        <section className="report-section" style={{ marginBottom: 16 }}>
          <h4>与上一次研究结果对比</h4>
          <div className="grid five calc-results history-diff-grid">
            <div><span className="muted">评分变化</span><strong className={diff.scoreDelta >= 0 ? 'pos' : 'neg'}>{diff.scoreDelta >= 0 ? '+' : ''}{diff.scoreDelta}</strong></div>
            <div><span className="muted">总 R 变化</span><strong className={diff.totalRDelta >= 0 ? 'pos' : 'neg'}>{diff.totalRDelta >= 0 ? '+' : ''}{diff.totalRDelta.toFixed(2)}R</strong></div>
            <div><span className="muted">OOS R 变化</span><strong className={diff.oosTotalRDelta >= 0 ? 'pos' : 'neg'}>{diff.oosTotalRDelta >= 0 ? '+' : ''}{diff.oosTotalRDelta.toFixed(2)}R</strong></div>
            <div><span className="muted">Funding 变化</span><strong className={diff.fundingRDelta >= 0 ? 'pos' : 'neg'}>{diff.fundingRDelta >= 0 ? '+' : ''}{diff.fundingRDelta.toFixed(2)}R</strong></div>
            <div><span className="muted">回撤变化</span><strong className={diff.maxDrawdownDelta <= 0 ? 'pos' : 'neg'}>{diff.maxDrawdownDelta >= 0 ? '+' : ''}{diff.maxDrawdownDelta.toFixed(2)}R</strong></div>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>对比基准：{new Date(latestPrevious.createdAt).toLocaleString()} / {latestPrevious.version}</p>
        </section>
      ) : null}

      <section className="report-section" style={{ marginBottom: 16 }}>
        <h4>历史趋势图</h4>
        <div className="grid three history-chart-grid">
          <div className="chart-card compact-chart-card">
            <h5>评分趋势</h5>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243244" />
                <XAxis dataKey="shortTime" stroke="#a7b4c2" />
                <YAxis stroke="#a7b4c2" />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#7cd4ff" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card compact-chart-card">
            <h5>OOS R 趋势</h5>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243244" />
                <XAxis dataKey="shortTime" stroke="#a7b4c2" />
                <YAxis stroke="#a7b4c2" />
                <Tooltip />
                <Line type="monotone" dataKey="oosTotalR" stroke="#7cf29a" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card compact-chart-card">
            <h5>Funding R 趋势</h5>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243244" />
                <XAxis dataKey="shortTime" stroke="#a7b4c2" />
                <YAxis stroke="#a7b4c2" />
                <Tooltip />
                <Line type="monotone" dataKey="fundingR" stroke="#ffd166" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="report-section">
        <h4>研究时间线</h4>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>版本</th>
              <th>回看</th>
              <th>里程碑</th>
              <th>最佳标记</th>
              <th>评分</th>
              <th>总 R</th>
              <th>OOS R</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {history.length ? history.map((item) => {
              const badges: string[] = []
              if (item.id === bestScoreId) badges.push('当前最佳分')
              if (item.id === bestOosId) badges.push('OOS最佳')
              if (item.id === mostStableId) badges.push('最稳版本')
              const noteValue = draftNotes[item.id] ?? item.note ?? ''
              return (
                <tr key={item.id} className={selectedId === item.id ? 'selected-row' : ''}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <div>{item.version}</div>
                    <div className="muted">{item.label}</div>
                  </td>
                  <td>
                    <button className="ghost-btn small-btn" onClick={() => onSelectItem(item)}>回看</button>
                  </td>
                  <td>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={Boolean(item.milestone)}
                        onChange={(e) => onUpdateItem(item.id, { milestone: e.target.checked })}
                      />
                      <span>{item.milestone ? '是' : '否'}</span>
                    </label>
                  </td>
                  <td>
                    <div className="tag-row">
                      {badges.length ? badges.map((badge) => <span key={badge} className="report-tag">{badge}</span>) : <span className="muted">-</span>}
                    </div>
                  </td>
                  <td>
                    <div>{item.score}</div>
                    <div className="muted">{item.verdict}</div>
                  </td>
                  <td className={item.totalR >= 0 ? 'pos' : 'neg'}>{item.totalR.toFixed(2)}R</td>
                  <td className={item.oosTotalR >= 0 ? 'pos' : 'neg'}>{item.oosTotalR.toFixed(2)}R</td>
                  <td>
                    <div className="history-note-cell">
                      <textarea
                        value={noteValue}
                        rows={2}
                        placeholder="比如：引入 funding / 调整 walk-forward / 结果明显改善..."
                        onChange={(e) => setDraftNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      />
                      <button className="ghost-btn small-btn" onClick={() => onUpdateItem(item.id, { note: noteValue })}>保存备注</button>
                    </div>
                  </td>
                </tr>
              )
            }) : (
              <tr>
                <td colSpan={9} className="muted">还没有历史记录。先运行一次回测，系统会自动归档。</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
