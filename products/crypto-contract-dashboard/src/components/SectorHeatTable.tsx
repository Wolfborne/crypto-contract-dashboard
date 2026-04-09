import type { SectorHeat } from '../types'

export function SectorHeatTable({ sectors }: { sectors: SectorHeat[] }) {
  return (
    <div className="card">
      <h3>赛道热度</h3>
      <table>
        <thead>
          <tr>
            <th>赛道</th>
            <th>平均 24h 涨跌</th>
            <th>样本数</th>
          </tr>
        </thead>
        <tbody>
          {sectors.map((sector) => (
            <tr key={sector.sector}>
              <td>{sector.sector}</td>
              <td className={sector.avg24hChange >= 0 ? 'pos' : 'neg'}>{sector.avg24hChange.toFixed(2)}%</td>
              <td>{sector.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
