import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MarketSnapshot } from '../types'

export function RotationChart({ snapshots }: { snapshots: MarketSnapshot[] }) {
  return (
    <div className="card chart-card">
      <h3>主流币 24h 强弱</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={snapshots}>
          <CartesianGrid strokeDasharray="3 3" stroke="#243244" />
          <XAxis dataKey="symbol" stroke="#a7b4c2" />
          <YAxis stroke="#a7b4c2" />
          <Tooltip />
          <Bar dataKey="change24h" fill="#5cc8ff" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
