import { SYMBOLS } from '../data/symbols'
import type {
  AlertEvent,
  BacktestResult,
  DashboardData,
  DashboardSettings,
  DashboardSignal,
  MarketSnapshot,
  MonthlyStat,
  ParameterScanRow,
  SectorHeat,
  MoonshotRadarResponse,
  ServerHealth,
  StrategyBreakdown,
  WalkForwardWindow
} from '../types'

const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || '/api'
const BACKTEST_FEE_PER_SIDE_PCT = 0.02
const BACKTEST_SLIPPAGE_PER_SIDE_PCT = 0.03
const BACKTEST_HOLD_BARS = 5
const WALK_FORWARD_TRAIN_BARS = 90
const WALK_FORWARD_TEST_BARS = 30
const WALK_FORWARD_STEP_BARS = 30

type Candle = { time: number; open: number; high: number; low: number; close: number }
type FundingPoint = { fundingTime: number; fundingRate: number }
type SimTrade = {
  symbol: string
  strategy: '均值回归' | '轮动跟随' | '趋势做空'
  side: 'LONG' | 'SHORT'
  priceOnlyR: number
  fundingR: number
  totalR: number
  entryTime: number
  exitTime: number
}

type CandidateTradeEvent = {
  symbol: string
  sector: string
  betaBucket: string
  environment: '恐慌/超卖' | '趋势/牛市' | '弱势/空头'
  strategy: '均值回归' | '轮动跟随' | '趋势做空'
  side: 'LONG' | 'SHORT'
  entryTime: number
  exitTime: number
  rawPriceOnlyR: number
  rawFundingR: number
}

type RegimeRiskProfile = {
  name: '趋势/牛市' | '弱势/空头' | '恐慌/超卖' | '震荡'
  maxOpenPositions: number
  maxSideExposure: number
  maxStrategyExposure: number
  maxSectorSideExposure: number
  maxBetaBucketSideExposure: number
  drawdownRiskOffTrigger: number
  drawdownHardStopTrigger: number
  dailyLossLimit: number
  weeklyLossLimit: number
}

type OpenPosition = {
  symbol: string
  sector: string
  betaBucket: string
  strategy: '均值回归' | '轮动跟随' | '趋势做空'
  side: 'LONG' | 'SHORT'
  entryTime: number
  exitTime: number
  size: number
}

type TradeModelResult = {
  priceOnlyR: number
  exitIndex: number
}
type SimStats = {
  tradeRs: number[]
  priceOnlyRs: number[]
  fundingRs: number[]
  trades: SimTrade[]
  monthlyMap: Map<string, MonthlyStat>
  strategyStats: Map<'均值回归' | '轮动跟随' | '趋势做空', number[]>
  strategyPriceOnly: Map<'均值回归' | '轮动跟随' | '趋势做空', number>
  strategyFunding: Map<'均值回归' | '轮动跟随' | '趋势做空', number>
}
function strategyRiskWeight(strategy: '均值回归' | '轮动跟随' | '趋势做空') {
  if (strategy === '轮动跟随') return 1
  if (strategy === '均值回归') return 0.85
  return 0.75
}

function streakRiskMultiplier(lossStreak: number) {
  if (lossStreak >= 4) return 0.35
  if (lossStreak >= 3) return 0.5
  if (lossStreak >= 2) return 0.7
  return 1
}

function riskProfileForEnvironment(environment: '恐慌/超卖' | '趋势/牛市' | '弱势/空头' | '震荡'): RegimeRiskProfile {
  if (environment === '趋势/牛市') {
    return {
      name: '趋势/牛市',
      maxOpenPositions: 4,
      maxSideExposure: 1.8,
      maxStrategyExposure: 1.1,
      maxSectorSideExposure: 1.1,
      maxBetaBucketSideExposure: 1.3,
      drawdownRiskOffTrigger: 3.5,
      drawdownHardStopTrigger: 5.5,
      dailyLossLimit: -2.5,
      weeklyLossLimit: -5
    }
  }
  if (environment === '弱势/空头') {
    return {
      name: '弱势/空头',
      maxOpenPositions: 4,
      maxSideExposure: 1.7,
      maxStrategyExposure: 1.0,
      maxSectorSideExposure: 1.0,
      maxBetaBucketSideExposure: 1.2,
      drawdownRiskOffTrigger: 3,
      drawdownHardStopTrigger: 5,
      dailyLossLimit: -2.2,
      weeklyLossLimit: -4.5
    }
  }
  if (environment === '恐慌/超卖') {
    return {
      name: '恐慌/超卖',
      maxOpenPositions: 2,
      maxSideExposure: 1.0,
      maxStrategyExposure: 0.8,
      maxSectorSideExposure: 0.7,
      maxBetaBucketSideExposure: 0.8,
      drawdownRiskOffTrigger: 2,
      drawdownHardStopTrigger: 3.5,
      dailyLossLimit: -1.5,
      weeklyLossLimit: -3
    }
  }
  return {
    name: '震荡',
    maxOpenPositions: 3,
    maxSideExposure: 1.2,
    maxStrategyExposure: 0.9,
    maxSectorSideExposure: 0.8,
    maxBetaBucketSideExposure: 1.0,
    drawdownRiskOffTrigger: 2.5,
    drawdownHardStopTrigger: 4,
    dailyLossLimit: -1.8,
    weeklyLossLimit: -3.5
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${url}`)
  return res.json()
}

async function fetchJsonOptional<T>(url: string, fallback: T): Promise<{ data: T, ok: boolean, reason: string | null }> {
  try {
    const data = await fetchJson<T>(url)
    return { data, ok: true, reason: null }
  } catch (error) {
    return { data: fallback, ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function sma(values: number[], period: number) {
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function calcAtr(candles: Candle[], endIndex: number, period = 14) {
  const start = Math.max(1, endIndex - period + 1)
  const trs: number[] = []
  for (let i = start; i <= endIndex; i++) {
    const prevClose = candles[i - 1]?.close ?? candles[i].close
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    )
    trs.push(tr)
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0
}

function pctDiff(price: number, avg: number) {
  return ((price - avg) / avg) * 100
}

export function classifyEnvironment(s: MarketSnapshot, settings: DashboardSettings): DashboardSignal['environment'] {
  if ((s.volatilityScore ?? 0) >= settings.extremeVolatilityThreshold && Math.abs(s.change24h ?? 0) > 6) return '极端事件候选'
  if ((s.ma20DiffPct ?? 0) <= settings.oversoldThreshold && (s.change24h ?? 0) < -3) return '恐慌/超卖'
  if ((s.ma20DiffPct ?? 0) >= settings.trendThreshold && (s.change24h ?? 0) > 1) return '趋势/牛市'
  if ((s.ma20DiffPct ?? 0) <= -settings.trendThreshold && (s.change24h ?? 0) < -1) return '弱势/空头'
  return '震荡'
}

function buildSignal(s: MarketSnapshot, settings: DashboardSettings): DashboardSignal {
  const environment = classifyEnvironment(s, settings)
  const price = s.price
  const signalBase = Math.round(50 + Math.max(0, Math.abs(s.ma20DiffPct ?? 0)) + Math.max(0, Math.abs(s.change24h) / 2) + Math.min(8, Math.abs((s.fundingRate ?? 0) * 10000)))

  if (environment === '恐慌/超卖') {
    return { symbol: s.symbol, strategy: '均值回归', environment, score: Math.min(89, signalBase), entry: `${(price * 0.993).toFixed(2)} - ${price.toFixed(2)}`, stopLoss: (price * 0.965).toFixed(2), takeProfit1: (price * 1.03).toFixed(2), takeProfit2: (price * 1.06).toFixed(2), note: '恐慌环境下只吃修复段，排除项目级利空。' }
  }
  if (environment === '趋势/牛市') {
    return { symbol: s.symbol, strategy: '轮动跟随', environment, score: Math.min(92, signalBase + 4), entry: `${(price * 0.998).toFixed(2)} - ${(price * 1.004).toFixed(2)}`, stopLoss: (price * 0.972).toFixed(2), takeProfit1: (price * 1.05).toFixed(2), takeProfit2: (price * 1.1).toFixed(2), note: '优先做相对强度刚转正、资金回流的品种。' }
  }
  if (environment === '弱势/空头') {
    return { symbol: s.symbol, strategy: '趋势做空', environment, score: Math.min(90, signalBase + 2), entry: `${(price * 0.996).toFixed(2)} - ${price.toFixed(2)}`, stopLoss: (price * 1.028).toFixed(2), takeProfit1: (price * 0.96).toFixed(2), takeProfit2: (price * 0.93).toFixed(2), note: '弱势环境只做顺势空，不主观摸底。' }
  }
  if (environment === '极端事件候选') {
    return { symbol: s.symbol, strategy: '错价修复候选', environment, score: Math.min(85, signalBase), entry: '等待二次确认 / 回抽承接', stopLoss: (price * 0.96).toFixed(2), takeProfit1: (price * 1.025).toFixed(2), takeProfit2: (price * 1.05).toFixed(2), note: '必须能解释错价来源与修复力量。' }
  }
  return { symbol: s.symbol, strategy: '均值回归', environment, score: Math.min(75, signalBase - 6), entry: '等待区间边缘 / 回踩确认', stopLoss: (price * 0.975).toFixed(2), takeProfit1: (price * 1.02).toFixed(2), takeProfit2: (price * 1.04).toFixed(2), note: '震荡市不追中间位置，宁缺毋滥。' }
}

function summarize(fearGreedValue: number, snapshots: MarketSnapshot[], settings: DashboardSettings) {
  const fearCount = snapshots.filter((s) => classifyEnvironment(s, settings) === '恐慌/超卖').length
  const trendCount = snapshots.filter((s) => classifyEnvironment(s, settings) === '趋势/牛市').length
  const shortCount = snapshots.filter((s) => classifyEnvironment(s, settings) === '弱势/空头').length
  const extremeCount = snapshots.filter((s) => classifyEnvironment(s, settings) === '极端事件候选').length
  if (extremeCount >= 2) return '波动显著抬升，先防守，只盯明确错价或超高质量 setup。'
  if (fearGreedValue < 30 || fearCount >= Math.ceil(snapshots.length / 2)) return '市场偏恐慌，优先看超卖修复，仓位与频率都收紧。'
  if (shortCount >= Math.ceil(snapshots.length / 2)) return '市场偏弱势，优先看顺势空和反抽失败。'
  if (fearGreedValue > 65 || trendCount >= Math.ceil(snapshots.length / 2)) return '市场偏风险偏好，优先看轮动跟随与补涨段。'
  return '市场偏中性震荡，信号标准要更苛刻，不追中间位置。'
}

export async function loadServerHealth(): Promise<ServerHealth> {
  return fetchJson(`${API_BASE}/health`)
}

export async function loadNotifierStatus(): Promise<{ ok: boolean; provider: string; enabled: boolean; configured: boolean; maskedWebhook: string | null }> {
  return fetchJson(`${API_BASE}/notifier/status`)
}

export async function loadDeliveryLog(): Promise<Array<{ ts: string; alertId?: string; title?: string; provider: string; ok: boolean; message?: string | null }>> {
  return fetchJson(`${API_BASE}/notifier/delivery-log`)
}

export async function loadNotifierQueueSummary(): Promise<{ ok: boolean; pending: number; failed: number; sent: number; acked: number; buffered: number; traderMode?: string; digestPriority?: string; digestWindowMs?: number; configSource?: string; digestBufferCreatedAt?: string | null; nextDigestAt?: string | null; digestItems?: Array<{ id: string; title: string; kind: string; severity?: string; createdAt: string; signature: string }>; retrying: Array<{ id: string; title: string; nextRetryAt?: string | null; retryCount?: number; lastDeliveryError?: string | null }> }> {
  return fetchJson(`${API_BASE}/notifier/queue-summary`)
}

export async function testNotifierSend(): Promise<{ ok: boolean; provider: string }> {
  const res = await fetch(`${API_BASE}/notifier/test-send`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to test notifier send')
  return res.json()
}

export async function flushDigestNow(): Promise<{ ok: boolean; flushed: boolean }> {
  const res = await fetch(`${API_BASE}/notifier/flush-digest`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to flush digest buffer')
  return res.json()
}

export async function loadReadinessState(): Promise<{ setups: Record<string, { setupKey: string; liveSmallLossStreak: number; liveOkLossStreak: number; forcedMaxDecision: 'NO_TRADE' | 'PAPER_ONLY' | 'LIVE_SMALL' | null; cooldownRemainingTrades: number; lastDegradeReason?: string; updatedAt: string }> }> {
  return fetchJson(`${API_BASE}/readiness-state`)
}

export async function updateReadinessStateOnTradeClose(payload: { setupKey: string; readinessDecision: 'LIVE_SMALL' | 'LIVE_OK' | 'PAPER_ONLY' | 'NO_TRADE'; realizedPnl: number; cooldownAfterDegradeTrades: number; liveSmallLossStreakToPaperOnly: number; liveOkLossStreakToLiveSmall: number; liveOkLossStreakToPaperOnly: number }): Promise<{ ok: boolean; item: { setupKey: string; liveSmallLossStreak: number; liveOkLossStreak: number; forcedMaxDecision: 'NO_TRADE' | 'PAPER_ONLY' | 'LIVE_SMALL' | null; cooldownRemainingTrades: number; lastDegradeReason?: string; updatedAt: string } }> {
  const res = await fetch(`${API_BASE}/readiness-state/trade-close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to update readiness trade-close state')
  return res.json()
}

export async function syncRuntimeState(payload: unknown): Promise<{ ok: boolean; updatedAt: string }> {
  const res = await fetch(`${API_BASE}/runtime/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to sync runtime state')
  return res.json()
}

export async function loadServerAlerts(status?: 'PENDING' | 'SENT' | 'ACKED'): Promise<AlertEvent[]> {
  const url = status ? `${API_BASE}/alerts?status=${status}` : `${API_BASE}/alerts`
  return fetchJson(url)
}

export async function loadMoonshotCandidates(): Promise<MoonshotRadarResponse> {
  return fetchJson(`${API_BASE}/moonshot/candidates`)
}

export async function emitServerAlerts(payload: { signals: Array<{ signal: DashboardSignal; preview: any; live: any; sizing: any }>; paperGateSummary: any }): Promise<{ ok: boolean; emitted: number; added: number; total: number }> {
  const res = await fetch(`${API_BASE}/alerts/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error('Failed to emit alerts')
  return res.json()
}

export async function enqueueServerAlerts(alerts: AlertEvent[]): Promise<{ ok: boolean; added: number; total: number }> {
  const res = await fetch(`${API_BASE}/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alerts)
  })
  if (!res.ok) throw new Error('Failed to enqueue alerts')
  return res.json()
}

export async function markServerAlertSent(id: string) {
  const res = await fetch(`${API_BASE}/alerts/${id}/sent`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to mark alert sent')
}

export async function ackServerAlert(id: string) {
  const res = await fetch(`${API_BASE}/alerts/${id}/ack`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to ack alert')
}

export async function loadDashboardData(settings: DashboardSettings): Promise<DashboardData> {
  const cgIds = SYMBOLS.map((s) => s.coingeckoId).join(',')
  const [fearGreed, coingeckoResult] = await Promise.all([
    fetchJsonOptional<any>(`${API_BASE}/fear-greed`, { data: [{ value: 50 }] }),
    fetchJsonOptional<any[]>(`${API_BASE}/coingecko/markets?ids=${cgIds}`, [])
  ])

  const marketMap = new Map(coingeckoResult.data.map((coin) => [coin.id, { marketCap: coin.market_cap, marketCapRank: coin.market_cap_rank }]))
  const snapshots = await Promise.all(SYMBOLS.map(async (cfg) => {
    const [ticker, oi, funding, klines] = await Promise.all([
      fetchJson<any>(`${API_BASE}/binance/ticker24h?symbol=${cfg.symbol}`),
      fetchJson<any[]>(`${API_BASE}/binance/open-interest?symbol=${cfg.symbol}`),
      fetchJson<any[]>(`${API_BASE}/binance/funding?symbol=${cfg.symbol}`),
      fetchJson<any[]>(`${API_BASE}/binance/klines?symbol=${cfg.symbol}&interval=1d&limit=30`)
    ])
    const closes = klines.map((k) => Number(k[4]))
    const price = Number(ticker.lastPrice)
    const ma20 = sma(closes, 20)
    const ma30 = sma(closes, 30)
    const extra = marketMap.get(cfg.coingeckoId)
    return {
      symbol: cfg.label,
      price,
      change24h: Number(ticker.priceChangePercent),
      volume24h: Number(ticker.quoteVolume),
      fundingRate: Number(funding?.[0]?.fundingRate ?? 0),
      openInterest: Number(oi?.[0]?.sumOpenInterestValue ?? oi?.[0]?.sumOpenInterest ?? 0),
      ma20DiffPct: pctDiff(price, ma20),
      ma30DiffPct: pctDiff(price, ma30),
      volatilityScore: Math.min(10, Math.abs(Number(ticker.priceChangePercent)) / 1.5),
      marketCap: extra?.marketCap,
      marketCapRank: extra?.marketCapRank,
      sector: cfg.sector
    } satisfies MarketSnapshot
  }))

  const fearGreedValue = Number(fearGreed.data?.[0]?.value ?? 50)
  const signals = snapshots.map((s) => buildSignal(s, settings)).sort((a, b) => b.score - a.score)
  const sectorMap = new Map<string, { total: number; count: number }>()
  for (const snap of snapshots) {
    const key = snap.sector ?? 'Other'
    const current = sectorMap.get(key) ?? { total: 0, count: 0 }
    current.total += snap.change24h
    current.count += 1
    sectorMap.set(key, current)
  }
  const sectorHeat: SectorHeat[] = [...sectorMap.entries()].map(([sector, value]) => ({ sector, avg24hChange: value.total / value.count, count: value.count })).sort((a, b) => b.avg24hChange - a.avg24hChange)
  return {
    snapshots,
    signals,
    fearGreedValue,
    environmentSummary: summarize(fearGreedValue, snapshots, settings),
    sectorHeat,
    dataSourceStatus: {
      coingecko: {
        ok: coingeckoResult.ok,
        degraded: !coingeckoResult.ok,
        reason: coingeckoResult.ok ? null : coingeckoResult.reason,
        lastSuccessAt: coingeckoResult.ok ? new Date().toISOString() : null,
      }
    }
  }
}

function feeAndSlippageR(entry: number, stop: number) {
  const totalPct = (BACKTEST_FEE_PER_SIDE_PCT + BACKTEST_SLIPPAGE_PER_SIDE_PCT) * 2 / 100
  return Math.abs((entry * totalPct) / Math.abs(entry - stop))
}

function maxDrawdownFromCurve(curve: number[]) {
  let peak = curve[0] ?? 0
  let maxDd = 0
  for (const point of curve) {
    if (point > peak) peak = point
    const dd = peak - point
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
}

function buildMetricRow(totalRs: number[], priceOnlyRs: number[] = [], fundingRs: number[] = []) {
  const wins = totalRs.filter((r) => r > 0).length
  const totalR = totalRs.reduce((a, b) => a + b, 0)
  const priceOnlyR = priceOnlyRs.reduce((a, b) => a + b, 0)
  const fundingR = fundingRs.reduce((a, b) => a + b, 0)
  const curve = [0]
  for (const r of totalRs) curve.push(curve[curve.length - 1] + r)
  const maxDrawdownR = maxDrawdownFromCurve(curve)
  const avgR = totalRs.length ? totalR / totalRs.length : 0
  return {
    trades: totalRs.length,
    winRate: totalRs.length ? (wins / totalRs.length) * 100 : 0,
    avgR,
    totalR,
    priceOnlyR,
    fundingR,
    maxDrawdownR,
    scoreProfitDrawdown: maxDrawdownR === 0 ? totalR : totalR / maxDrawdownR,
    scoreExpectancy: avgR
  }
}

function calcFundingR(entry: number, stop: number, entryTime: number, exitTime: number, side: 'LONG' | 'SHORT', fundingSeries: FundingPoint[]) {
  const riskPct = Math.abs(entry - stop) / entry
  if (!riskPct) return 0
  const fundingSum = fundingSeries
    .filter((point) => point.fundingTime > entryTime && point.fundingTime <= exitTime)
    .reduce((sum, point) => sum + point.fundingRate, 0)
  const signedPct = side === 'LONG' ? -fundingSum : fundingSum
  return signedPct / riskPct
}

function simulateTradeModel(candles: Candle[], side: 'LONG' | 'SHORT', entry: number, stop: number, tp1: number, tp2: number, holdBars: number, startIndex: number): TradeModelResult {
  let remaining = 1
  let realizedR = 0
  let trailingArmed = false
  let dynamicStop = stop
  let exitIndex = Math.min(startIndex + holdBars, candles.length - 1)
  let trailAnchor = entry
  const riskUnit = Math.abs(entry - stop)
  const atrAtEntry = calcAtr(candles, startIndex, 14) || riskUnit
  const timeExitBars = Math.max(3, Math.floor(holdBars * 0.8))

  const finalIndex = Math.min(startIndex + holdBars, candles.length - 1)
  for (let j = startIndex + 1; j <= finalIndex; j++) {
    const candle = candles[j]
    const barsHeld = j - startIndex
    const closes = candles.slice(0, j + 1).map((c) => c.close)
    const ma20 = sma(closes, Math.min(20, closes.length))

    if (side === 'LONG') {
      if (trailingArmed) {
        trailAnchor = Math.max(trailAnchor, candle.high)
        const candidateStop = trailAnchor - atrAtEntry * 1.2
        dynamicStop = Math.max(entry, candidateStop)
      }

      const hitStop = candle.low <= dynamicStop
      const hitTp1 = candle.high >= tp1
      const hitTp2 = candle.high >= tp2
      const invalidated = trailingArmed && candle.close < ma20
      const timedOut = barsHeld >= timeExitBars && !trailingArmed && candle.close < entry * 1.005

      if (hitStop && !trailingArmed) {
        realizedR += remaining * -1
        remaining = 0
        exitIndex = j
        break
      }

      if (hitTp1 && remaining === 1) {
        realizedR += 0.5 * Math.abs((tp1 - entry) / (entry - stop))
        remaining = 0.5
        trailingArmed = true
        trailAnchor = Math.max(tp1, candle.high)
        dynamicStop = Math.max(entry, trailAnchor - atrAtEntry * 1.2)
        if (hitTp2) {
          realizedR += 0.5 * Math.abs((tp2 - entry) / (entry - stop))
          remaining = 0
          exitIndex = j
          break
        }
        if (candle.low <= dynamicStop) {
          const trailingR = (dynamicStop - entry) / Math.abs(entry - stop)
          realizedR += remaining * Math.max(0, trailingR)
          remaining = 0
          exitIndex = j
          break
        }
        continue
      }

      if (hitTp2 && remaining > 0) {
        realizedR += remaining * Math.abs((tp2 - entry) / (entry - stop))
        remaining = 0
        exitIndex = j
        break
      }

      if (trailingArmed && hitStop) {
        const trailingR = (dynamicStop - entry) / Math.abs(entry - stop)
        realizedR += remaining * Math.max(0, trailingR)
        remaining = 0
        exitIndex = j
        break
      }

      if (invalidated || timedOut) {
        const exitR = (candle.close - entry) / Math.abs(entry - stop)
        realizedR += remaining * exitR
        remaining = 0
        exitIndex = j
        break
      }
    } else {
      if (trailingArmed) {
        trailAnchor = Math.min(trailAnchor, candle.low)
        const candidateStop = trailAnchor + atrAtEntry * 1.2
        dynamicStop = Math.min(entry, candidateStop)
      }

      const hitStop = candle.high >= dynamicStop
      const hitTp1 = candle.low <= tp1
      const hitTp2 = candle.low <= tp2
      const invalidated = trailingArmed && candle.close > ma20
      const timedOut = barsHeld >= timeExitBars && !trailingArmed && candle.close > entry * 0.995

      if (hitStop && !trailingArmed) {
        realizedR += remaining * -1
        remaining = 0
        exitIndex = j
        break
      }

      if (hitTp1 && remaining === 1) {
        realizedR += 0.5 * Math.abs((entry - tp1) / (stop - entry))
        remaining = 0.5
        trailingArmed = true
        trailAnchor = Math.min(tp1, candle.low)
        dynamicStop = Math.min(entry, trailAnchor + atrAtEntry * 1.2)
        if (hitTp2) {
          realizedR += 0.5 * Math.abs((entry - tp2) / (stop - entry))
          remaining = 0
          exitIndex = j
          break
        }
        if (candle.high >= dynamicStop) {
          const trailingR = (entry - dynamicStop) / Math.abs(stop - entry)
          realizedR += remaining * Math.max(0, trailingR)
          remaining = 0
          exitIndex = j
          break
        }
        continue
      }

      if (hitTp2 && remaining > 0) {
        realizedR += remaining * Math.abs((entry - tp2) / (stop - entry))
        remaining = 0
        exitIndex = j
        break
      }

      if (trailingArmed && hitStop) {
        const trailingR = (entry - dynamicStop) / Math.abs(stop - entry)
        realizedR += remaining * Math.max(0, trailingR)
        remaining = 0
        exitIndex = j
        break
      }

      if (invalidated || timedOut) {
        const exitR = (entry - candle.close) / Math.abs(stop - entry)
        realizedR += remaining * exitR
        remaining = 0
        exitIndex = j
        break
      }
    }

    exitIndex = j
  }

  if (remaining > 0) {
    const close = candles[exitIndex].close
    const fallbackR = side === 'SHORT'
      ? (entry - close) / Math.abs(stop - entry)
      : (close - entry) / Math.abs(entry - stop)
    realizedR += remaining * fallbackR
  }

  return { priceOnlyR: realizedR, exitIndex }
}

function betaBucketForSymbol(symbol: string) {
  if (['BTC', 'ETH', 'SOL', 'AVAX', 'BNB'].includes(symbol)) return 'HIGH_BETA_MAJOR'
  if (['DOGE', 'XRP'].includes(symbol)) return 'HIGH_BETA_ALT'
  return 'NORMAL'
}

function generateCandidateTradeEvents(
  symbol: string,
  sector: string,
  candles: Candle[],
  fundingSeries: FundingPoint[],
  oversoldThreshold: number,
  trendThreshold: number,
  holdBars: number,
  extremeVolatilityThreshold: number,
  startIndex = 30,
  endExclusive = candles.length
): CandidateTradeEvent[] {
  const events: CandidateTradeEvent[] = []
  const firstIndex = Math.max(30, startIndex)
  const lastSignalIndex = Math.min(endExclusive - holdBars - 1, candles.length - holdBars - 1)

  for (let i = firstIndex; i < lastSignalIndex; i++) {
    const closes = candles.slice(0, i + 1).map((c) => c.close)
    const ma20 = sma(closes, 20)
    const price = candles[i].close
    const change24h = ((candles[i].close - candles[i - 1].close) / candles[i - 1].close) * 100
    const snap: MarketSnapshot = { symbol, price, change24h, ma20DiffPct: pctDiff(price, ma20), volatilityScore: Math.abs(change24h) / 1.5 }
    const env = classifyEnvironment(snap, {
      oversoldThreshold,
      trendThreshold,
      extremeVolatilityThreshold,
      perTradeRiskPct: 0.5,
      leverage: 3,
      accountEquity: 10000,
      sizingMode: 'FIXED_CAPITAL',
      riskSoftCapUsd: 75,
      riskHardCapUsd: 100,
      maxConcurrentRiskUsd: 250,
      traderTimeZone: 'Asia/Shanghai',
      traderDayStartHour: 8,
      traderNightStartHour: 23,
      digestLiveOkDayWindowSec: 90,
      digestLiveOkNightWindowSec: 180,
      digestLiveSmallDayWindowSec: 300,
      digestLiveSmallNightWindowSec: 720,
      traderDayImmediateLiveOk: true,
      traderNightImmediateLiveOk: false,
      readiness: {
        enabled: true,
        liveSmallRiskMultiplier: 0.25,
        liveSmallLossStreakToPaperOnly: 2,
        liveOkLossStreakToLiveSmall: 2,
        liveOkLossStreakToPaperOnly: 3,
        cooldownAfterDegradeTrades: 3,
        minSampleForLiveSmall: 15,
        minSampleForLiveOk: 30,
        validationWindowTrades: 20,
        minWinRateForLiveSmall: 45,
        minWinRateForLiveOk: 50,
        minAvgRForLiveSmall: 0.1,
        minAvgRForLiveOk: 0.2,
        maxValidationDrawdownForLiveSmall: 3,
        maxValidationDrawdownForLiveOk: 2.5,
        liveSmallAllowedExecution: ['ALLOW_FULL', 'ALLOW_CAPPED'],
        liveOkAllowedExecution: ['ALLOW_FULL'],
        liveOkEnvironments: ['趋势/牛市', '恐慌/超卖', '震荡'],
        liveSmallEnvironments: ['趋势/牛市', '恐慌/超卖', '震荡'],
        liveOkStrategies: ['轮动跟随', '均值回归'],
        liveSmallStrategies: ['轮动跟随', '均值回归', '趋势做空'],
        minRRForLiveSmall: 1.5,
        minRRForLiveOk: 2,
        maxDirectionalRiskR: 0.75,
        maxSectorRiskR: 0.5,
        maxBetaBucketRiskR: 0.75,
        maxOpenLivePositions: 2,
        maxSlippagePctForLiveSmall: 0.2,
        maxSlippagePctForLiveOk: 0.1,
      },
    })
    if (env !== '恐慌/超卖' && env !== '趋势/牛市' && env !== '弱势/空头') continue

    const strategy = env === '恐慌/超卖' ? '均值回归' : env === '趋势/牛市' ? '轮动跟随' : '趋势做空'
    const side: 'LONG' | 'SHORT' = env === '弱势/空头' ? 'SHORT' : 'LONG'
    const entryTime = candles[i + 1].time
    const entry = candles[i + 1].open
    const stop = env === '恐慌/超卖' ? entry * 0.965 : env === '趋势/牛市' ? entry * 0.972 : entry * 1.028
    const tp1 = env === '恐慌/超卖' ? entry * 1.02 : env === '趋势/牛市' ? entry * 1.035 : entry * 0.965
    const tp2 = env === '恐慌/超卖' ? entry * 1.05 : env === '趋势/牛市' ? entry * 1.07 : entry * 0.94
    const modeled = simulateTradeModel(candles, side, entry, stop, tp1, tp2, holdBars, i)
    const rawPriceOnlyR = modeled.priceOnlyR - feeAndSlippageR(entry, stop)
    const exitTime = candles[modeled.exitIndex].time
    const rawFundingR = calcFundingR(entry, stop, entryTime, exitTime, side, fundingSeries)

    events.push({
      symbol,
      sector,
      betaBucket: betaBucketForSymbol(symbol),
      environment: env,
      strategy,
      side,
      entryTime,
      exitTime,
      rawPriceOnlyR,
      rawFundingR
    })
  }

  return events
}

function runPortfolioEventSimulation(events: CandidateTradeEvent[]): SimStats {
  const sorted = [...events].sort((a, b) => (a.entryTime - b.entryTime) || a.symbol.localeCompare(b.symbol))
  const tradeRs: number[] = []
  const priceOnlyRs: number[] = []
  const fundingRs: number[] = []
  const trades: SimTrade[] = []
  const monthlyMap = new Map<string, MonthlyStat>()
  const strategyStats = new Map<'均值回归' | '轮动跟随' | '趋势做空', number[]>()
  const strategyPriceOnly = new Map<'均值回归' | '轮动跟随' | '趋势做空', number>()
  const strategyFunding = new Map<'均值回归' | '轮动跟随' | '趋势做空', number>()
  strategyStats.set('均值回归', [0])
  strategyStats.set('轮动跟随', [0])
  strategyStats.set('趋势做空', [0])
  strategyPriceOnly.set('均值回归', 0)
  strategyPriceOnly.set('轮动跟随', 0)
  strategyPriceOnly.set('趋势做空', 0)
  strategyFunding.set('均值回归', 0)
  strategyFunding.set('轮动跟随', 0)
  strategyFunding.set('趋势做空', 0)

  const RISK_OFF_MULTIPLIER = 0.5
  const HARD_STOP_COOLDOWN_TRADES = 3

  let lossStreak = 0
  let openPositions: OpenPosition[] = []
  let equity = 0
  let peakEquity = 0
  let cooldownTrades = 0
  let currentDayKey = ''
  let currentWeekKey = ''
  let dayPnL = 0
  let weekPnL = 0

  for (const event of sorted) {
    openPositions = openPositions.filter((pos) => pos.exitTime > event.entryTime)

    const entryDate = new Date(event.entryTime)
    const dayKey = entryDate.toISOString().slice(0, 10)
    const weekStart = new Date(entryDate)
    const day = weekStart.getUTCDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    weekStart.setUTCDate(weekStart.getUTCDate() + diffToMonday)
    const weekKey = weekStart.toISOString().slice(0, 10)

    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey
      dayPnL = 0
    }
    if (weekKey !== currentWeekKey) {
      currentWeekKey = weekKey
      weekPnL = 0
    }

    const profile = riskProfileForEnvironment(event.environment)
    const currentDrawdown = peakEquity - equity
    if (cooldownTrades > 0) {
      cooldownTrades -= 1
      continue
    }
    if (dayPnL <= profile.dailyLossLimit) continue
    if (weekPnL <= profile.weeklyLossLimit) continue

    const longExposure = openPositions.filter((p) => p.side === 'LONG').reduce((sum, p) => sum + p.size, 0)
    const shortExposure = openPositions.filter((p) => p.side === 'SHORT').reduce((sum, p) => sum + p.size, 0)
    const strategyExposure = openPositions.filter((p) => p.strategy === event.strategy).reduce((sum, p) => sum + p.size, 0)
    const sectorSideExposure = openPositions
      .filter((p) => p.sector === event.sector && p.side === event.side)
      .reduce((sum, p) => sum + p.size, 0)
    const betaBucketSideExposure = openPositions
      .filter((p) => p.betaBucket === event.betaBucket && p.side === event.side)
      .reduce((sum, p) => sum + p.size, 0)

    let size = strategyRiskWeight(event.strategy) * streakRiskMultiplier(lossStreak)
    if (currentDrawdown >= profile.drawdownHardStopTrigger) {
      cooldownTrades = HARD_STOP_COOLDOWN_TRADES
      continue
    }
    if (currentDrawdown >= profile.drawdownRiskOffTrigger) {
      size *= RISK_OFF_MULTIPLIER
    }
    if (openPositions.length >= profile.maxOpenPositions) continue

    if (event.side === 'LONG') {
      const remaining = profile.maxSideExposure - longExposure
      if (remaining <= 0) continue
      size = Math.min(size, remaining)
    } else {
      const remaining = profile.maxSideExposure - shortExposure
      if (remaining <= 0) continue
      size = Math.min(size, remaining)
    }

    const remainingStrategy = profile.maxStrategyExposure - strategyExposure
    if (remainingStrategy <= 0) continue
    size = Math.min(size, remainingStrategy)

    const remainingSectorSide = profile.maxSectorSideExposure - sectorSideExposure
    if (remainingSectorSide <= 0) continue
    size = Math.min(size, remainingSectorSide)

    const remainingBetaBucketSide = profile.maxBetaBucketSideExposure - betaBucketSideExposure
    if (remainingBetaBucketSide <= 0) continue
    size = Math.min(size, remainingBetaBucketSide)
    if (size <= 0.15) continue

    const scaledPriceOnlyR = event.rawPriceOnlyR * size
    const scaledFundingR = event.rawFundingR * size
    const totalR = scaledPriceOnlyR + scaledFundingR

    tradeRs.push(totalR)
    priceOnlyRs.push(scaledPriceOnlyR)
    fundingRs.push(scaledFundingR)
    trades.push({
      symbol: event.symbol,
      strategy: event.strategy,
      side: event.side,
      priceOnlyR: scaledPriceOnlyR,
      fundingR: scaledFundingR,
      totalR,
      entryTime: event.entryTime,
      exitTime: event.exitTime
    })

    openPositions.push({
      symbol: event.symbol,
      sector: event.sector,
      betaBucket: event.betaBucket,
      strategy: event.strategy,
      side: event.side,
      entryTime: event.entryTime,
      exitTime: event.exitTime,
      size
    })

    const stratCurve = strategyStats.get(event.strategy)!
    stratCurve.push(stratCurve[stratCurve.length - 1] + totalR)
    strategyPriceOnly.set(event.strategy, (strategyPriceOnly.get(event.strategy) ?? 0) + scaledPriceOnlyR)
    strategyFunding.set(event.strategy, (strategyFunding.get(event.strategy) ?? 0) + scaledFundingR)
    lossStreak = totalR < 0 ? lossStreak + 1 : 0
    equity += totalR
    dayPnL += totalR
    weekPnL += totalR
    if (equity > peakEquity) peakEquity = equity

    const month = new Date(event.exitTime).toISOString().slice(0, 7)
    const currentMonth = monthlyMap.get(month) ?? { month, trades: 0, totalR: 0 }
    currentMonth.trades += 1
    currentMonth.totalR += totalR
    monthlyMap.set(month, currentMonth)
  }

  return { tradeRs, priceOnlyRs, fundingRs, trades, monthlyMap, strategyStats, strategyPriceOnly, strategyFunding }
}

function runStrategySimulation(
  candleCache: Map<string, Candle[]>,
  fundingCache: Map<string, FundingPoint[]>,
  oversoldThreshold: number,
  trendThreshold: number,
  holdBars: number,
  extremeVolatilityThreshold: number,
  startIndex = 30,
  endExclusive?: number
): SimStats {
  const events: CandidateTradeEvent[] = []
  for (const cfg of SYMBOLS) {
    const candles = candleCache.get(cfg.symbol)!
    const fundingSeries = fundingCache.get(cfg.symbol) ?? []
    events.push(...generateCandidateTradeEvents(
      cfg.label,
      cfg.sector,
      candles,
      fundingSeries,
      oversoldThreshold,
      trendThreshold,
      holdBars,
      extremeVolatilityThreshold,
      startIndex,
      endExclusive ?? candles.length
    ))
  }
  return runPortfolioEventSimulation(events)
}

function scanParameters(candleCache: Map<string, Candle[]>, fundingCache: Map<string, FundingPoint[]>, settings: DashboardSettings, startIndex = 30, endExclusive?: number) {
  const parameterScan: ParameterScanRow[] = []
  const oversoldCandidates = [-10, -8, -6]
  const trendCandidates = [3, 4, 5]
  const holdBarsCandidates = [3, 5, 7]

  for (const oversold of oversoldCandidates) {
    for (const trend of trendCandidates) {
      for (const holdBars of holdBarsCandidates) {
        let tradeRs: number[] = []
        let priceOnlyRs: number[] = []
        let fundingRs: number[] = []
        const sim = runStrategySimulation(candleCache, fundingCache, oversold, trend, holdBars, settings.extremeVolatilityThreshold, startIndex, endExclusive)
        tradeRs = tradeRs.concat(sim.tradeRs)
        priceOnlyRs = priceOnlyRs.concat(sim.priceOnlyRs)
        fundingRs = fundingRs.concat(sim.fundingRs)
        const metrics = buildMetricRow(tradeRs, priceOnlyRs, fundingRs)
        parameterScan.push({
          oversoldThreshold: oversold,
          trendThreshold: trend,
          holdBars,
          trades: metrics.trades,
          winRate: metrics.winRate,
          avgR: metrics.avgR,
          totalR: metrics.totalR,
          maxDrawdownR: metrics.maxDrawdownR,
          scoreProfitDrawdown: metrics.scoreProfitDrawdown,
          scoreExpectancy: metrics.scoreExpectancy
        })
      }
    }
  }

  parameterScan.sort((a, b) => (b.scoreProfitDrawdown - a.scoreProfitDrawdown) || (b.totalR - a.totalR))
  return parameterScan
}

function runWalkForward(candleCache: Map<string, Candle[]>, fundingCache: Map<string, FundingPoint[]>, settings: DashboardSettings) {
  const minLength = Math.min(...SYMBOLS.map((cfg) => candleCache.get(cfg.symbol)?.length ?? 0))
  const windows: WalkForwardWindow[] = []
  const oosTradeRs: number[] = []
  const oosPriceOnlyRs: number[] = []
  const oosFundingRs: number[] = []

  let trainStart = 30
  let windowIndex = 1
  while (trainStart + WALK_FORWARD_TRAIN_BARS + WALK_FORWARD_TEST_BARS < minLength) {
    const trainEnd = trainStart + WALK_FORWARD_TRAIN_BARS
    const testEnd = trainEnd + WALK_FORWARD_TEST_BARS
    const scan = scanParameters(candleCache, fundingCache, settings, trainStart, trainEnd)
    const best = scan[0]
    if (!best) break

    const sim = runStrategySimulation(candleCache, fundingCache, best.oversoldThreshold, best.trendThreshold, best.holdBars, settings.extremeVolatilityThreshold, trainEnd, testEnd)
    const testTradeRs: number[] = sim.tradeRs
    const testPriceOnlyRs: number[] = sim.priceOnlyRs
    const testFundingRs: number[] = sim.fundingRs
    oosTradeRs.push(...testTradeRs)
    oosPriceOnlyRs.push(...testPriceOnlyRs)
    oosFundingRs.push(...testFundingRs)
    const metrics = buildMetricRow(testTradeRs, testPriceOnlyRs, testFundingRs)
    const refCandles = candleCache.get(SYMBOLS[0].symbol)!
    windows.push({
      windowIndex,
      trainStart: new Date(refCandles[trainStart].time).toISOString().slice(0, 10),
      trainEnd: new Date(refCandles[trainEnd - 1].time).toISOString().slice(0, 10),
      testStart: new Date(refCandles[trainEnd].time).toISOString().slice(0, 10),
      testEnd: new Date(refCandles[testEnd - 1].time).toISOString().slice(0, 10),
      selectedBy: '收益/回撤',
      bestParams: {
        oversoldThreshold: best.oversoldThreshold,
        trendThreshold: best.trendThreshold,
        holdBars: best.holdBars
      },
      trainTrades: best.trades,
      trainTotalR: best.totalR,
      testTrades: metrics.trades,
      testWinRate: metrics.winRate,
      testAvgR: metrics.avgR,
      testPriceOnlyR: metrics.priceOnlyR,
      testFundingR: metrics.fundingR,
      testTotalR: metrics.totalR,
      testMaxDrawdownR: metrics.maxDrawdownR
    })

    trainStart += WALK_FORWARD_STEP_BARS
    windowIndex += 1
  }

  const summaryMetrics = buildMetricRow(oosTradeRs, oosPriceOnlyRs, oosFundingRs)
  return {
    enabled: true,
    trainBars: WALK_FORWARD_TRAIN_BARS,
    testBars: WALK_FORWARD_TEST_BARS,
    stepBars: WALK_FORWARD_STEP_BARS,
    windows,
    summary: {
      windows: windows.length,
      trades: summaryMetrics.trades,
      winRate: summaryMetrics.winRate,
      avgR: summaryMetrics.avgR,
      totalR: summaryMetrics.totalR,
      priceOnlyR: summaryMetrics.priceOnlyR,
      fundingR: summaryMetrics.fundingR,
      maxDrawdownR: summaryMetrics.maxDrawdownR
    }
  }
}

function buildMachineAssessment(parameterScan: ParameterScanRow[], walkForward: BacktestResult['walkForward'], summary: BacktestResult['summary']) {
  const tags: string[] = []
  const rationale: string[] = []
  let score = 50

  if (summary.totalR > 0) {
    score += 10
    rationale.push('全样本累计收益为正。')
  } else {
    score -= 12
    tags.push('全样本收益为负')
    rationale.push('全样本累计收益为负，说明基础 edge 仍不稳。')
  }

  if (walkForward.summary.totalR > 0) {
    score += 18
    rationale.push('样本外结果仍保持正收益。')
  } else {
    score -= 18
    tags.push('样本外偏弱')
    rationale.push('walk-forward 样本外结果偏弱，是主要扣分项。')
  }

  if (walkForward.summary.maxDrawdownR <= 4) {
    score += 8
    rationale.push('样本外最大回撤控制较好。')
  } else if (walkForward.summary.maxDrawdownR <= 8) {
    score += 2
    tags.push('回撤可控但偏大')
    rationale.push('样本外回撤尚可接受，但不算漂亮。')
  } else {
    score -= 10
    tags.push('回撤过大')
    rationale.push('样本外最大回撤偏大，需要压低风险暴露。')
  }

  if (Math.abs(summary.fundingR) < 0.3) {
    score += 4
    rationale.push('funding 对结果扰动有限。')
  } else if (summary.fundingR > 0) {
    score += 6
    tags.push('funding 友好')
    rationale.push('funding 对净收益有辅助贡献。')
  } else {
    score -= 8
    tags.push('funding 侵蚀明显')
    rationale.push('funding 对净收益形成了可见侵蚀。')
  }

  const top1 = parameterScan[0]
  const top5 = parameterScan.slice(0, 5)
  const stableBand = top1 && top5.length
    ? top5.filter((row) => Math.abs(row.totalR - top1.totalR) <= Math.max(1, Math.abs(top1.totalR) * 0.25)).length
    : 0

  if (stableBand >= 3) {
    score += 8
    rationale.push('Top 参数组之间差距不大，参数稳定性较好。')
  } else {
    score -= 10
    tags.push('参数不稳定')
    rationale.push('Top 参数结果集中在少数组合，存在参数脆弱迹象。')
  }

  if (walkForward.summary.windows >= 3) {
    score += 4
    rationale.push('walk-forward 窗口数量达到基础参考要求。')
  } else {
    score -= 6
    tags.push('窗口数量不足')
    rationale.push('walk-forward 窗口偏少，结论可信度有限。')
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let confidence: '低' | '中' | '高' = '中'
  if (walkForward.summary.windows >= 4 && stableBand >= 3) confidence = '高'
  if (walkForward.summary.windows <= 2 || score < 45) confidence = '低'

  let label: '可继续研究' | '谨慎观察' | '暂不建议实盘' | '参数不稳定' = '谨慎观察'
  if (tags.includes('参数不稳定')) label = '参数不稳定'
  else if (score >= 75 && walkForward.summary.totalR > 0) label = '可继续研究'
  else if (score < 50 || walkForward.summary.totalR <= 0) label = '暂不建议实盘'

  let verdict: 'GREEN' | 'YELLOW' | 'RED' = 'YELLOW'
  if (label === '可继续研究') verdict = 'GREEN'
  if (label === '暂不建议实盘' || score < 45) verdict = 'RED'

  const verdictText = verdict === 'GREEN'
    ? '绿灯：可继续研究'
    : verdict === 'YELLOW'
      ? '黄灯：谨慎观察'
      : '红灯：暂不建议实盘'

  const keyConcern = tags[0] ?? '暂无显著结构性问题'
  const summaryLine = verdict === 'GREEN'
    ? '结果具备继续研究价值，但仍应优先看样本外稳定性。'
    : verdict === 'YELLOW'
      ? '结果可参考，但当前更适合观察与压测，而不是贸然放大信心。'
      : '结果暂不支持执行层升级，先修复主要失真或不稳定项。'

  const nextAction = verdict === 'GREEN'
    ? '扩大样本区间，继续观察不同市场阶段下的样本外稳定性。'
    : verdict === 'YELLOW'
      ? '优先检查参数稳定性、funding 侵蚀和回撤来源，再决定是否继续。'
      : '先回到研究环节，重新收紧参数、优化风险模型，并复核样本外表现。'

  return {
    score,
    confidence,
    label,
    verdict,
    verdictText,
    summaryLine,
    nextAction,
    keyConcern,
    tags: [...new Set(tags)],
    rationale
  }
}

function buildResearchReport(parameterScan: ParameterScanRow[], byStrategy: StrategyBreakdown[], walkForward: BacktestResult['walkForward'], summary: BacktestResult['summary']) {
  const best = parameterScan[0]
  const stable = [...parameterScan].sort((a, b) => (b.scoreExpectancy - a.scoreExpectancy) || (b.scoreProfitDrawdown - a.scoreProfitDrawdown))[0]
  const strongest = [...byStrategy].sort((a, b) => b.totalR - a.totalR)[0]
  const weakest = [...byStrategy].sort((a, b) => a.totalR - b.totalR)[0]
  const wf = walkForward.summary
  const oosTone = wf.totalR > 0 ? '样本外仍保留正收益' : '样本外表现偏弱'
  const stability = wf.maxDrawdownR <= 5 ? '回撤仍在可研究范围内' : '回撤偏大，需要继续收紧参数或仓位假设'
  const fundingTakeaway = Math.abs(summary.fundingR) < 0.01
    ? '当前持仓周期较短，funding 对总结果影响较小。'
    : summary.fundingR > 0
      ? `Funding 对净收益有正贡献，累计约 ${summary.fundingR.toFixed(2)}R。`
      : `Funding 对净收益形成侵蚀，累计约 ${summary.fundingR.toFixed(2)}R。`
  const machineAssessment = buildMachineAssessment(parameterScan, walkForward, summary)

  return {
    title: 'V7 自动研究报告',
    conclusion: `全样本扫描显示 ${strongest?.strategy ?? '主策略'} 当前贡献最高；walk-forward ${oosTone}，且 ${stability}。`,
    currentRecommendation: wf.totalR > 0 ? '可继续沿当前框架迭代，但应优先观察样本外稳定性，而不是追逐全样本最优。' : '先不要把结果当作可执行 edge，优先继续压测参数稳定性与失效阶段。',
    strongestStrategy: strongest ? `${strongest.strategy}（${strongest.totalR.toFixed(2)}R）` : '-',
    weakestStrategy: weakest ? `${weakest.strategy}（${weakest.totalR.toFixed(2)}R）` : '-',
    bestParameterSet: best ? `超卖 ${best.oversoldThreshold} / 趋势 ${best.trendThreshold} / 持有 ${best.holdBars} bars` : '-',
    mostStableParameterSet: stable ? `超卖 ${stable.oversoldThreshold} / 趋势 ${stable.trendThreshold} / 持有 ${stable.holdBars} bars` : '-',
    walkForwardTakeaway: wf.windows ? `共 ${wf.windows} 个窗口，OOS ${wf.totalR.toFixed(2)}R，胜率 ${wf.winRate.toFixed(1)}%，最大回撤 ${wf.maxDrawdownR.toFixed(2)}R。` : '窗口不足，暂时无法给出可靠的 walk-forward 结论。',
    fundingTakeaway,
    riskNotes: [
      '当前仍是启发式研究回测，不含真实 intrabar 撮合。',
      'Funding 已按持仓跨越的结算点近似计入，但仍不是交易所逐笔精确结算。',
      '参数扫描维度有限，仍需防范样本内过拟合。'
    ],
    machineAssessment
  }
}

export async function loadBacktest(settings: DashboardSettings): Promise<BacktestResult> {
  const candleCache = new Map<string, Candle[]>()
  const fundingCache = new Map<string, FundingPoint[]>()

  for (const cfg of SYMBOLS) {
    const [klines, funding] = await Promise.all([
      fetchJson<any[]>(`${API_BASE}/binance/klines?symbol=${cfg.symbol}&interval=1d&limit=220`),
      fetchJson<any[]>(`${API_BASE}/binance/funding?symbol=${cfg.symbol}&limit=1000`)
    ])
    candleCache.set(cfg.symbol, klines.map((k) => ({ time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) })))
    fundingCache.set(cfg.symbol, funding.map((row) => ({ fundingTime: Number(row.fundingTime), fundingRate: Number(row.fundingRate) })))
  }

  const sim = runStrategySimulation(candleCache, fundingCache, settings.oversoldThreshold, settings.trendThreshold, BACKTEST_HOLD_BARS, settings.extremeVolatilityThreshold)
  const combinedCurve: number[] = [0]
  for (const r of sim.tradeRs) combinedCurve.push(combinedCurve[combinedCurve.length - 1] + r)

  const results = SYMBOLS.map((cfg) => {
    const symbolTrades = sim.trades.filter((t) => t.symbol === cfg.label)
    const metrics = buildMetricRow(symbolTrades.map((t) => t.totalR), symbolTrades.map((t) => t.priceOnlyR), symbolTrades.map((t) => t.fundingR))
    return {
      symbol: cfg.label,
      trades: metrics.trades,
      winRate: metrics.winRate,
      avgR: metrics.avgR,
      totalR: metrics.totalR,
      priceOnlyR: metrics.priceOnlyR,
      fundingR: metrics.fundingR,
      maxDrawdownR: metrics.maxDrawdownR
    }
  }) as BacktestResult['bySymbol']

  const byStrategy: StrategyBreakdown[] = ['均值回归', '轮动跟随', '趋势做空'].map((strategy) => {
    const strategyTrades = sim.trades.filter((t) => t.strategy === strategy)
    const metrics = buildMetricRow(strategyTrades.map((t) => t.totalR), strategyTrades.map((t) => t.priceOnlyR), strategyTrades.map((t) => t.fundingR))
    return {
      strategy: strategy as '均值回归' | '轮动跟随' | '趋势做空',
      trades: metrics.trades,
      winRate: metrics.winRate,
      avgR: metrics.avgR,
      totalR: metrics.totalR,
      priceOnlyR: metrics.priceOnlyR,
      fundingR: metrics.fundingR,
      maxDrawdownR: metrics.maxDrawdownR
    }
  })
  const parameterScan = scanParameters(candleCache, fundingCache, settings)
  const walkForward = runWalkForward(candleCache, fundingCache, settings)
  const globalTrades = sim.tradeRs.length
  const globalWins = sim.tradeRs.filter((r) => r > 0).length
  const globalTotalR = sim.tradeRs.reduce((a, b) => a + b, 0)
  const globalPriceOnlyR = sim.priceOnlyRs.reduce((a, b) => a + b, 0)
  const globalFundingR = sim.fundingRs.reduce((a, b) => a + b, 0)
  const summary = {
    trades: globalTrades,
    winRate: globalTrades ? (globalWins / globalTrades) * 100 : 0,
    avgR: globalTrades ? globalTotalR / globalTrades : 0,
    totalR: globalTotalR,
    priceOnlyR: globalPriceOnlyR,
    fundingR: globalFundingR,
    maxDrawdownR: maxDrawdownFromCurve(combinedCurve),
    expectancy: globalTrades ? globalTotalR / globalTrades : 0
  }
  const monthly = [...sim.monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month))
  const report = buildResearchReport(parameterScan, byStrategy, walkForward, summary)

  return {
    bySymbol: results,
    byStrategy,
    parameterScan,
    summary,
    equityCurve: combinedCurve.map((equityR, index) => ({ index, equityR })),
    monthly,
    walkForward,
    report,
    assumptions: {
      feePerSidePct: BACKTEST_FEE_PER_SIDE_PCT,
      slippagePerSidePct: BACKTEST_SLIPPAGE_PER_SIDE_PCT,
      holdBars: BACKTEST_HOLD_BARS,
      fundingIncluded: true,
      partialTakeProfit: true,
      dynamicTrailingStop: true,
      timeExitEnabled: true,
      invalidationExitEnabled: true,
      strategyRiskBudgetEnabled: true,
      lossStreakThrottleEnabled: true,
      dailyLossLimitEnabled: true,
      weeklyLossLimitEnabled: true,
      regimeAwareRiskEnabled: true,
      intrabarMode: 'conservative'
    }
  }
}

export function exportToCsv(rows: Record<string, string | number>[]) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h] ?? '')).join(','))].join('\n')
}

export function exportResearchReportMarkdown(result: BacktestResult | null) {
  if (!result) return ''
  const wfTable = result.walkForward.windows.map((row) => (
    `| ${row.windowIndex} | ${row.trainStart} ~ ${row.trainEnd} | ${row.testStart} ~ ${row.testEnd} | ${row.bestParams.oversoldThreshold}/${row.bestParams.trendThreshold}/${row.bestParams.holdBars} | ${row.testPriceOnlyR.toFixed(2)} | ${row.testFundingR.toFixed(2)} | ${row.testTotalR.toFixed(2)} |`
  )).join('\n')
  const strategyTable = result.byStrategy.map((row) => (
    `| ${row.strategy} | ${row.priceOnlyR.toFixed(2)} | ${row.fundingR.toFixed(2)} | ${row.totalR.toFixed(2)} |`
  )).join('\n')

  return `# ${result.report.title}

## 1. 首页 Verdict
- 红黄绿灯：${result.report.machineAssessment.verdictText}
- 机器评分：${result.report.machineAssessment.score}/100
- 建议标签：${result.report.machineAssessment.label}
- 结论置信度：${result.report.machineAssessment.confidence}
- 关键担忧：${result.report.machineAssessment.keyConcern}
- 一句话判断：${result.report.machineAssessment.summaryLine}
- 下一步动作：${result.report.machineAssessment.nextAction}
- 标签：${result.report.machineAssessment.tags.join('、') || '无'}

## 2. 机器评分与建议标签
### 机器理由
${result.report.machineAssessment.rationale.map((item) => `- ${item}`).join('\n')}

## 3. 研究结论
${result.report.conclusion}

**当前建议：** ${result.report.currentRecommendation}

## 4. 核心指标
- 总交易数：${result.summary.trades}
- 胜率：${result.summary.winRate.toFixed(1)}%
- 期望 R：${result.summary.expectancy.toFixed(2)}
- 累计 R：${result.summary.totalR.toFixed(2)}R
- 价格收益：${result.summary.priceOnlyR.toFixed(2)}R
- Funding 收益：${result.summary.fundingR.toFixed(2)}R
- 最大回撤：${result.summary.maxDrawdownR.toFixed(2)}R

## 5. 参数与策略判断
- 最优参数组：${result.report.bestParameterSet}
- 最稳参数组：${result.report.mostStableParameterSet}
- 最强策略：${result.report.strongestStrategy}
- 最弱策略：${result.report.weakestStrategy}

## 6. Walk-forward 结论
${result.report.walkForwardTakeaway}

| 窗口 | 训练区间 | 测试区间 | 参数 | 价格R | FundingR | 测试R |
|---|---|---|---|---:|---:|---:|
${wfTable}

## 7. Funding 分析
${result.report.fundingTakeaway}

| 策略 | 价格R | FundingR | 累计R |
|---|---:|---:|---:|
${strategyTable}

## 8. 风险提示
${result.report.riskNotes.map((note) => `- ${note}`).join('\n')}
`
}

export function exportResearchReportHtml(result: BacktestResult | null) {
  if (!result) return ''
  const css = `body{font-family:Inter,Arial,sans-serif;background:#0b1020;color:#edf2f7;padding:32px;line-height:1.6}h1,h2{color:#7cd4ff}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #243244;padding:10px;text-align:left}th{background:#121d31}.pos{color:#7cf29a}.neg{color:#ff8f8f}.card{background:#111a2b;border:1px solid #26384f;border-radius:16px;padding:20px;margin-bottom:20px}.tag{display:inline-block;padding:6px 10px;margin:6px 6px 0 0;border-radius:999px;background:#121d31;border:1px solid #2d4059;color:#87d7ff}`
  const wfRows = result.walkForward.windows.map((row) => `<tr><td>${row.windowIndex}</td><td>${row.trainStart} ~ ${row.trainEnd}</td><td>${row.testStart} ~ ${row.testEnd}</td><td>${row.bestParams.oversoldThreshold}/${row.bestParams.trendThreshold}/${row.bestParams.holdBars}</td><td class="${row.testPriceOnlyR >= 0 ? 'pos' : 'neg'}">${row.testPriceOnlyR.toFixed(2)}R</td><td class="${row.testFundingR >= 0 ? 'pos' : 'neg'}">${row.testFundingR.toFixed(2)}R</td><td class="${row.testTotalR >= 0 ? 'pos' : 'neg'}">${row.testTotalR.toFixed(2)}R</td></tr>`).join('')
  const strategyRows = result.byStrategy.map((row) => `<tr><td>${row.strategy}</td><td class="${row.priceOnlyR >= 0 ? 'pos' : 'neg'}">${row.priceOnlyR.toFixed(2)}R</td><td class="${row.fundingR >= 0 ? 'pos' : 'neg'}">${row.fundingR.toFixed(2)}R</td><td class="${row.totalR >= 0 ? 'pos' : 'neg'}">${row.totalR.toFixed(2)}R</td></tr>`).join('')
  const riskItems = result.report.riskNotes.map((note) => `<li>${note}</li>`).join('')
  const rationaleItems = result.report.machineAssessment.rationale.map((note) => `<li>${note}</li>`).join('')
  const tags = result.report.machineAssessment.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${result.report.title}</title><style>${css}</style></head><body><div class="card"><h1>${result.report.title}</h1><h2>首页 Verdict</h2><ul><li>红黄绿灯：${result.report.machineAssessment.verdictText}</li><li>机器评分：${result.report.machineAssessment.score}/100</li><li>建议标签：${result.report.machineAssessment.label}</li><li>结论置信度：${result.report.machineAssessment.confidence}</li><li>关键担忧：${result.report.machineAssessment.keyConcern}</li><li>一句话判断：${result.report.machineAssessment.summaryLine}</li><li>下一步动作：${result.report.machineAssessment.nextAction}</li></ul>${tags}</div><div class="card"><h2>机器评分与建议标签</h2><ul>${rationaleItems}</ul></div><div class="card"><h2>研究结论</h2><p>${result.report.conclusion}</p><p><strong>当前建议：</strong>${result.report.currentRecommendation}</p></div><div class="card"><h2>核心指标</h2><ul><li>总交易数：${result.summary.trades}</li><li>胜率：${result.summary.winRate.toFixed(1)}%</li><li>期望 R：${result.summary.expectancy.toFixed(2)}</li><li>累计 R：${result.summary.totalR.toFixed(2)}R</li><li>价格收益：${result.summary.priceOnlyR.toFixed(2)}R</li><li>Funding 收益：${result.summary.fundingR.toFixed(2)}R</li><li>最大回撤：${result.summary.maxDrawdownR.toFixed(2)}R</li></ul></div><div class="card"><h2>参数与策略判断</h2><ul><li>最优参数组：${result.report.bestParameterSet}</li><li>最稳参数组：${result.report.mostStableParameterSet}</li><li>最强策略：${result.report.strongestStrategy}</li><li>最弱策略：${result.report.weakestStrategy}</li></ul></div><div class="card"><h2>Walk-forward 结论</h2><p>${result.report.walkForwardTakeaway}</p><table><thead><tr><th>窗口</th><th>训练区间</th><th>测试区间</th><th>参数</th><th>价格R</th><th>FundingR</th><th>测试R</th></tr></thead><tbody>${wfRows}</tbody></table></div><div class="card"><h2>Funding 分析</h2><p>${result.report.fundingTakeaway}</p><table><thead><tr><th>策略</th><th>价格R</th><th>FundingR</th><th>累计R</th></tr></thead><tbody>${strategyRows}</tbody></table></div><div class="card"><h2>风险提示</h2><ul>${riskItems}</ul></div></body></html>`
}
