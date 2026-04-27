import { ReactNode } from 'react'

export function KpiCard({ title, value, sub }: { title: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card kpi-card">
      <div className="muted">{title}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  )
}
