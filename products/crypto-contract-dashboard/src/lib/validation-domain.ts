import type { PaperTrade, ValidationStatsMap } from '../types'

function calcLossStreak(trades: PaperTrade[]) {
  let streak = 0
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    const pnl = trades[i].realizedPnl ?? 0
    if (pnl < 0) streak += 1
    else break
  }
  return streak
}

function calcMaxLossStreak(trades: PaperTrade[]) {
  let max = 0
  let current = 0
  for (const trade of trades) {
    const pnl = trade.realizedPnl ?? 0
    if (pnl < 0) {
      current += 1
      max = Math.max(max, current)
    } else {
      current = 0
    }
  }
  return max
}

function calcDrawdownProxy(trades: PaperTrade[]) {
  let equity = 0
  let peak = 0
  let maxDrawdown = 0
  for (const trade of trades) {
    equity += trade.realizedPnl ?? 0
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity - peak)
  }
  return Math.abs(maxDrawdown)
}

function calcDrawdownR(trades: PaperTrade[]) {
  let equityR = 0
  let peakR = 0
  let maxDrawdownR = 0
  for (const trade of trades) {
    equityR += trade.resultR ?? 0
    peakR = Math.max(peakR, equityR)
    maxDrawdownR = Math.min(maxDrawdownR, equityR - peakR)
  }
  return Math.abs(maxDrawdownR)
}

export function buildValidationStatsBySetup(trades: PaperTrade[], windowSize: number): ValidationStatsMap {
  const closed = trades
    .filter((trade) => trade.status === 'CLOSED' && trade.readinessSetupKey)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const grouped = new Map<string, PaperTrade[]>()
  for (const trade of closed) {
    const key = trade.readinessSetupKey as string
    const list = grouped.get(key) ?? []
    list.push(trade)
    grouped.set(key, list)
  }

  const result: ValidationStatsMap = {}
  for (const [setupKey, setupTrades] of grouped.entries()) {
    const recent = setupTrades.slice(-windowSize)
    const winCount = recent.filter((trade) => (trade.realizedPnl ?? 0) > 0).length
    const lossCount = recent.filter((trade) => (trade.realizedPnl ?? 0) < 0).length
    const realizedPnl = recent.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
    const totalResultR = recent.reduce((sum, trade) => sum + (trade.resultR ?? 0), 0)
    result[setupKey] = {
      setupKey,
      sampleCount: recent.length,
      closedCount: recent.length,
      winCount,
      lossCount,
      winRate: recent.length ? (winCount / recent.length) * 100 : 0,
      realizedPnl,
      avgRealizedPnl: recent.length ? realizedPnl / recent.length : 0,
      avgRProxy: recent.length ? totalResultR / recent.length : 0,
      avgResultR: recent.length ? totalResultR / recent.length : 0,
      totalResultR,
      lossStreak: calcLossStreak(recent),
      maxLossStreak: calcMaxLossStreak(recent),
      drawdownProxy: calcDrawdownProxy(recent),
      drawdownR: calcDrawdownR(recent),
      lastUpdatedAt: recent[recent.length - 1]?.closedAt ?? recent[recent.length - 1]?.createdAt,
    }
  }

  return result
}
