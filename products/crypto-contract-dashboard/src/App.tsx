import { useEffect, useMemo, useState } from 'react'
import { BacktestPanel } from './components/BacktestPanel'
import { HistoricalReportViewer } from './components/HistoricalReportViewer'
import { JournalPanel } from './components/JournalPanel'
import { KpiCard } from './components/KpiCard'
import { PaperTradingPanel } from './components/PaperTradingPanel'
import { PositionCalculator } from './components/PositionCalculator'
import { ReportHistoryPanel } from './components/ReportHistoryPanel'
import { ResearchReportPanel } from './components/ResearchReportPanel'
import { RotationChart } from './components/RotationChart'
import { SectorHeatTable } from './components/SectorHeatTable'
import { SettingsPanel } from './components/SettingsPanel'
import { SignalTable } from './components/SignalTable'
import { ackServerAlert, exportResearchReportHtml, exportResearchReportMarkdown, exportToCsv, flushDigestNow, loadBacktest, loadDashboardData, loadDeliveryLog, loadNotifierQueueSummary, loadNotifierStatus, loadReadinessState, loadServerAlerts, markServerAlertSent, syncRuntimeState, testNotifierSend, updateReadinessStateOnTradeClose as updateReadinessStateOnTradeCloseApi } from './lib/api'
import { evaluateLiveReadiness as evaluateLiveReadinessDomain, parseEntryRange } from './lib/alert-domain'
import { buildReadinessSetupKey, evaluateReadinessWithValidationAndRuntime } from './lib/readiness-domain'
import { SYMBOLS } from './data/symbols'
import { archiveBacktestResult, buildReportDiff, defaultSettings, loadAlertDedupe, loadJournal, loadPaperTrades, loadReportHistory, loadSettings, saveAlertDedupe, saveJournal, savePaperTrades, saveReportHistory, saveSettings, updateReportHistoryItem } from './lib/storage'
import { buildValidationStatsBySetup } from './lib/validation-domain'
import type { AlertEvent, BacktestResult, DashboardSignal, DashboardSettings, DataSourceHealth, ExecutionStatus, ExecutionStatusStat, LiveReadiness, MarketSnapshot, PaperEquityPoint, PaperGatePreview, PaperGateSummary, PaperTrade, ReadinessEvaluation, ReadinessRuntimeState, ResearchReportArchiveItem, ResearchReportDiff, SectorHeat, TradeJournalEntry, ValidationStatsMap } from './types'

function parsePriceText(value: string) {
  const matched = value.match(/-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

function calcRoughRiskReward(signal: DashboardSignal) {
  const entry = parseEntryRange(signal.entry).mid
  const stop = parsePriceText(signal.stopLoss)
  const tp1 = parsePriceText(signal.takeProfit1)
  if (!entry || !stop || !tp1) return null
  const risk = Math.abs(entry - stop)
  const reward = Math.abs(tp1 - entry)
  if (!risk) return null
  return reward / risk
}

function explainCapTrigger(preCapRiskUsd: number, softCappedRiskUsd: number, hardCappedRiskUsd: number, remainingConcurrentRiskUsd: number, finalRiskUsd: number) {
  const reasons: string[] = []
  if (softCappedRiskUsd < preCapRiskUsd) reasons.push(`soft cap ${softCappedRiskUsd.toFixed(2)}`)
  if (hardCappedRiskUsd < softCappedRiskUsd) reasons.push(`hard cap ${hardCappedRiskUsd.toFixed(2)}`)
  if (finalRiskUsd < hardCappedRiskUsd) reasons.push(`concurrent risk budget ${remainingConcurrentRiskUsd.toFixed(2)}`)
  return reasons.length ? reasons.join(' + ') : 'none'
}

function extractSymbolFromAlertTitle(title: string) {
  const matched = title.match(/\]\s+([A-Z]{2,10})\b/)
  return matched?.[1] ?? null
}

function getTradeDirection(signal: DashboardSignal) {
  return signal.strategy === '趋势做空'
    ? { side: 'SHORT', label: '做空 / SHORT' }
    : { side: 'LONG', label: '做多 / LONG' }
}

function getReadinessSummaryChips(readiness?: ReadinessEvaluation | null) {
  const chips: Array<{ label: string; tone: 'downgrade' | 'validation'; tooltip: string }> = []
  if (!readiness) return chips
  if (readiness.degradeReason) chips.push({ label: 'COOLDOWN', tone: 'downgrade', tooltip: readiness.degradeReason })
  for (const reason of readiness.validationReasons ?? []) {
    if (reason.includes('样本不足')) chips.push({ label: 'LOW_SAMPLE', tone: 'validation', tooltip: reason })
    else if (reason.includes('胜率不足')) chips.push({ label: 'LOW_WINRATE', tone: 'validation', tooltip: reason })
    else if (reason.includes('平均收益不足')) chips.push({ label: 'NEG_AVG', tone: 'validation', tooltip: reason })
    else if (reason.includes('drawdown 过大')) chips.push({ label: 'HIGH_DD', tone: 'validation', tooltip: reason })
    else chips.push({ label: 'VALIDATION_WEAK', tone: 'validation', tooltip: reason })
  }
  return chips.filter((chip, idx, arr) => arr.findIndex((item) => item.label === chip.label) === idx)
}

function isBufferedAlert(item?: { status?: string; lastDeliveryError?: string | null } | null) {
  return item?.status === 'FAILED' && Boolean(item?.lastDeliveryError?.includes('buffered for'))
}

function getAlertStatusLabel(item?: { status?: string; lastDeliveryError?: string | null } | null) {
  if (isBufferedAlert(item)) return 'BUFFERED（已进入摘要缓冲）'
  return item?.status ?? 'PENDING'
}

function getDeliveryDisplay(item: { ok: boolean; message?: string | null }) {
  if (!item.ok && item.message?.includes('buffered for')) return { label: 'BUFFERED', className: 'muted' }
  return item.ok ? { label: 'SUCCESS', className: 'pos' } : { label: 'FAILED', className: 'neg' }
}

function calcSizingSuggestion(signal: DashboardSignal, settings: DashboardSettings, sizingEquityUsd: number, currentConcurrentRiskUsd: number, gate: ReturnType<typeof evaluatePaperTradeGate> | null, gatePreview?: PaperGatePreview) {
  const entry = parseEntryRange(signal.entry).mid
  const stop = parsePriceText(signal.stopLoss)
  if (!entry || !stop) return null

  const equityUsd = sizingEquityUsd
  const baseRiskUsd = equityUsd * (settings.perTradeRiskPct / 100)
  const gateSizeFactor = gate?.allowed ? (gate.size ?? 0) : gatePreview?.verdict === 'RISK_OFF' ? 0.5 : gatePreview?.verdict === 'ALLOW' ? 1 : 0
  const preCapRiskUsd = baseRiskUsd * gateSizeFactor
  const softCappedRiskUsd = Math.min(preCapRiskUsd, settings.riskSoftCapUsd)
  const hardCappedRiskUsd = Math.min(softCappedRiskUsd, settings.riskHardCapUsd)
  const remainingConcurrentRiskUsd = Math.max(0, settings.maxConcurrentRiskUsd - currentConcurrentRiskUsd)
  const riskUsd = Math.min(hardCappedRiskUsd, remainingConcurrentRiskUsd)
  const capReason = explainCapTrigger(preCapRiskUsd, softCappedRiskUsd, hardCappedRiskUsd, remainingConcurrentRiskUsd, riskUsd)
  const riskPerUnit = Math.abs(entry - stop)
  if (!riskPerUnit) return null

  const quantity = riskUsd / riskPerUnit
  const rawNotionalUsd = quantity * entry
  const leveragedNotionalUsd = rawNotionalUsd * settings.leverage
  const cappedNotionalUsd = gate?.allowed ? Math.min(leveragedNotionalUsd, gate.notionalUsd ?? leveragedNotionalUsd) : leveragedNotionalUsd
  const finalQuantity = entry > 0 ? cappedNotionalUsd / entry : quantity
  const effectiveRiskUsd = finalQuantity * riskPerUnit

  return {
    riskUsd: effectiveRiskUsd,
    quantity: finalQuantity,
    notionalUsd: cappedNotionalUsd,
    baseRiskUsd,
    leverage: settings.leverage,
    gateSizeFactor,
    preCapRiskUsd,
    remainingConcurrentRiskUsd,
    cappedBy: capReason,
    capDetail: capReason === 'none' ? '未触发 sizing caps' : `触发 ${capReason}`
  }
}

function calcPnl(side: PaperTrade['side'], entryPrice: number, exitPrice: number, quantity: number) {
  return side === 'LONG'
    ? (exitPrice - entryPrice) * quantity
    : (entryPrice - exitPrice) * quantity
}

function syncPaperTradeWithMarket(trade: PaperTrade, snapshots: MarketSnapshot[]): PaperTrade {
  const snapshot = snapshots.find((item) => item.symbol === trade.symbol)
  const currentPrice = snapshot?.price
  if (!currentPrice || !trade.entryPrice || !trade.quantity) {
    return trade
  }

  const stopLoss = parsePriceText(trade.stopLoss)
  const takeProfit1 = parsePriceText(trade.takeProfit1)
  let next: PaperTrade = {
    ...trade,
    currentPrice,
    unrealizedPnl: calcPnl(trade.side, trade.entryPrice, currentPrice, trade.quantity)
  }

  if (trade.status !== 'OPEN') {
    return next
  }

  const hitTakeProfit = takeProfit1
    ? trade.side === 'LONG' ? currentPrice >= takeProfit1 : currentPrice <= takeProfit1
    : false
  const hitStopLoss = stopLoss
    ? trade.side === 'LONG' ? currentPrice <= stopLoss : currentPrice >= stopLoss
    : false

  if (hitTakeProfit || hitStopLoss) {
    const exitPrice = hitTakeProfit ? takeProfit1! : stopLoss!
    const realizedPnl = calcPnl(trade.side, trade.entryPrice, exitPrice, trade.quantity)
    const realizedPnlPct = trade.notionalUsd ? (realizedPnl / trade.notionalUsd) * 100 : 0
    next = {
      ...next,
      status: 'CLOSED',
      exitPrice,
      closedAt: new Date().toISOString(),
      exitReason: hitTakeProfit ? 'TAKE_PROFIT' : 'STOP_LOSS',
      realizedPnl,
      realizedPnlPct,
      unrealizedPnl: 0
    }
  }

  return next
}

function buildPaperEquityCurve(trades: PaperTrade[], startingEquity = 10000): PaperEquityPoint[] {
  const closedTrades = trades
    .filter((trade) => trade.status === 'CLOSED')
    .sort((a, b) => new Date(a.closedAt ?? a.createdAt).getTime() - new Date(b.closedAt ?? b.createdAt).getTime())

  let equityUsd = startingEquity
  return closedTrades.map((trade, index) => {
    equityUsd += trade.realizedPnl ?? 0
    return {
      index,
      label: `${trade.symbol} ${trade.exitReason ?? 'CLOSE'}`,
      equityUsd
    }
  })
}

function betaBucketForSymbol(symbol: string) {
  if (['BTC', 'ETH', 'SOL', 'AVAX', 'BNB'].includes(symbol)) return 'HIGH_BETA_MAJOR'
  if (['DOGE', 'XRP'].includes(symbol)) return 'HIGH_BETA_ALT'
  return 'NORMAL'
}

function strategyRiskWeight(strategy: PaperTrade['strategy']) {
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

function riskProfileForEnvironment(environment: PaperTrade['environment']) {
  if (environment === '趋势/牛市') {
    return {
      maxOpenPositions: 4,
      maxSideExposure: 1.8,
      maxStrategyExposure: 1.1,
      maxSectorSideExposure: 1.1,
      maxBetaBucketSideExposure: 1.3,
      drawdownRiskOffTrigger: 3.5,
      drawdownHardStopTrigger: 5.5,
      dailyLossLimit: -250,
      weeklyLossLimit: -500
    }
  }
  if (environment === '弱势/空头') {
    return {
      maxOpenPositions: 4,
      maxSideExposure: 1.7,
      maxStrategyExposure: 1.0,
      maxSectorSideExposure: 1.0,
      maxBetaBucketSideExposure: 1.2,
      drawdownRiskOffTrigger: 300,
      drawdownHardStopTrigger: 500,
      dailyLossLimit: -220,
      weeklyLossLimit: -450
    }
  }
  if (environment === '恐慌/超卖') {
    return {
      maxOpenPositions: 2,
      maxSideExposure: 1.0,
      maxStrategyExposure: 0.8,
      maxSectorSideExposure: 0.7,
      maxBetaBucketSideExposure: 0.8,
      drawdownRiskOffTrigger: 200,
      drawdownHardStopTrigger: 350,
      dailyLossLimit: -150,
      weeklyLossLimit: -300
    }
  }
  return {
    maxOpenPositions: 3,
    maxSideExposure: 1.2,
    maxStrategyExposure: 0.9,
    maxSectorSideExposure: 0.8,
    maxBetaBucketSideExposure: 1.0,
    drawdownRiskOffTrigger: 250,
    drawdownHardStopTrigger: 400,
    dailyLossLimit: -180,
    weeklyLossLimit: -350
  }
}

function getDayKey(value?: string) {
  return new Date(value ?? Date.now()).toISOString().slice(0, 10)
}

function getWeekKey(value?: string) {
  const d = new Date(value ?? Date.now())
  const day = d.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diffToMonday)
  return d.toISOString().slice(0, 10)
}

function buildPaperGateSummary(trades: PaperTrade[], activeRegime?: DashboardSignal['environment']): PaperGateSummary {
  const openTrades = trades.filter((trade) => trade.status === 'OPEN')
  const closedTrades = trades.filter((trade) => trade.status === 'CLOSED')
  const regime = activeRegime ?? '未激活'
  const profile = activeRegime ? riskProfileForEnvironment(activeRegime) : {
    maxOpenPositions: 0,
    maxSideExposure: 0,
    maxStrategyExposure: 0,
    maxSectorSideExposure: 0,
    maxBetaBucketSideExposure: 0,
    drawdownRiskOffTrigger: 0,
    drawdownHardStopTrigger: 0,
    dailyLossLimit: 0,
    weeklyLossLimit: 0
  }

  const currentEquity = 10000 + closedTrades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
  let runningEquity = 10000
  let peakEquity = 10000
  for (const trade of [...closedTrades].sort((a, b) => new Date(a.closedAt ?? a.createdAt).getTime() - new Date(b.closedAt ?? b.createdAt).getTime())) {
    runningEquity += trade.realizedPnl ?? 0
    if (runningEquity > peakEquity) peakEquity = runningEquity
  }
  const drawdown = Math.max(0, peakEquity - currentEquity)
  const todayPnl = closedTrades.filter((trade) => getDayKey(trade.closedAt ?? trade.createdAt) === getDayKey()).reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
  const weekPnl = closedTrades.filter((trade) => getWeekKey(trade.closedAt ?? trade.createdAt) === getWeekKey()).reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)

  const longUsed = openTrades.filter((trade) => trade.side === 'LONG').reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const shortUsed = openTrades.filter((trade) => trade.side === 'SHORT').reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)

  const strategyMap = new Map<string, number>()
  const sectorMap = new Map<string, number>()
  const betaMap = new Map<string, number>()
  for (const trade of openTrades) {
    const unit = (trade.notionalUsd ?? 0) / 1000
    strategyMap.set(trade.strategy, (strategyMap.get(trade.strategy) ?? 0) + unit)
    const sector = SYMBOLS.find((item) => item.label === trade.symbol)?.sector ?? 'Other'
    sectorMap.set(`${sector}-${trade.side}`, (sectorMap.get(`${sector}-${trade.side}`) ?? 0) + unit)
    const beta = betaBucketForSymbol(trade.symbol)
    betaMap.set(`${beta}-${trade.side}`, (betaMap.get(`${beta}-${trade.side}`) ?? 0) + unit)
  }

  const riskMode = !activeRegime
    ? 'NORMAL'
    : drawdown >= profile.drawdownHardStopTrigger
      ? 'HARD_STOP'
      : drawdown >= profile.drawdownRiskOffTrigger
        ? 'RISK_OFF'
        : 'NORMAL'

  const lastDecision = trades[0]?.gateReason

  return {
    regime,
    riskMode,
    openPositions: openTrades.length,
    maxOpenPositions: profile.maxOpenPositions,
    currentEquity,
    peakEquity,
    drawdown,
    drawdownRiskOffTrigger: profile.drawdownRiskOffTrigger,
    drawdownHardStopTrigger: profile.drawdownHardStopTrigger,
    todayPnl,
    dailyLossLimit: profile.dailyLossLimit,
    weekPnl,
    weeklyLossLimit: profile.weeklyLossLimit,
    exposures: {
      long: { used: longUsed, limit: profile.maxSideExposure },
      short: { used: shortUsed, limit: profile.maxSideExposure },
      strategies: [...strategyMap.entries()].map(([key, used]) => ({ key, used, limit: profile.maxStrategyExposure })),
      sectors: [...sectorMap.entries()].map(([key, used]) => ({ key, used, limit: profile.maxSectorSideExposure })),
      betaBuckets: [...betaMap.entries()].map(([key, used]) => ({ key, used, limit: profile.maxBetaBucketSideExposure }))
    },
    lastDecision
  }
}

function environmentPriorityMultiplier(environment: DashboardSignal['environment']) {
  if (environment === '趋势/牛市') return 1.05
  if (environment === '恐慌/超卖') return 1
  if (environment === '弱势/空头') return 0.98
  if (environment === '震荡') return 0.9
  return 0.75
}

function environmentWhyNow(environment: DashboardSignal['environment']) {
  if (environment === '趋势/牛市') return '趋势环境加权更友好'
  if (environment === '恐慌/超卖') return '超卖修复窗口仍可做'
  if (environment === '弱势/空头') return '弱势环境支持顺势空头逻辑'
  if (environment === '震荡') return '震荡环境加权较低，需要更挑剔'
  return '极端环境仅做保守观察'
}

function scoreWhyNow(score: number) {
  if (score >= 85) return '信号分数很高'
  if (score >= 75) return '信号分数较强'
  if (score >= 65) return '信号分数中等可观察'
  return '信号分数一般'
}

function getExecutionStatus(gate: ReturnType<typeof evaluatePaperTradeGate>, sizing?: ReturnType<typeof calcSizingSuggestion> | null) {
  if (!gate.allowed) return 'BLOCKED_GATE' as const
  if ((sizing?.riskUsd ?? 0) <= 0) return 'BLOCKED_BUDGET' as const
  if (gate.riskMode === 'RISK_OFF') return sizing && sizing.cappedBy !== 'none' ? 'RISK_OFF_CAPPED' as const : 'RISK_OFF' as const
  return sizing && sizing.cappedBy !== 'none' ? 'ALLOW_CAPPED' as const : 'ALLOW_FULL' as const
}

function chineseExecutionStatus(status: ExecutionStatus) {
  if (status === 'ALLOW_FULL') return '完全放行'
  if (status === 'ALLOW_CAPPED') return '放行但已压缩'
  if (status === 'RISK_OFF') return '风险收缩'
  if (status === 'RISK_OFF_CAPPED') return '风险收缩且已压缩'
  if (status === 'BLOCKED_BUDGET') return '预算拦截'
  return '风控拦截'
}

function evaluateLiveReadiness(signal: DashboardSignal, preview: PaperGatePreview | undefined, paperGateSummary: PaperGateSummary, executionStats: ExecutionStatusStat[]): { status: LiveReadiness, reason: string } {
  const stat = preview?.executionStatus ? executionStats.find((item) => item.status === preview.executionStatus) : undefined
  const enoughSample = (stat?.closed ?? 0) >= 20
  const profitable = (stat?.realizedPnl ?? 0) > 0
  const healthyWinRate = (stat?.winRate ?? 0) >= 50
  const preferredEnvironment = ['趋势/牛市', '恐慌/超卖'].includes(signal.environment)
  const preferredStrategy = ['轮动跟随', '均值回归'].includes(signal.strategy)
  const dailyBlocked = paperGateSummary.todayPnl <= paperGateSummary.dailyLossLimit
  const weeklyBlocked = paperGateSummary.weekPnl <= paperGateSummary.weeklyLossLimit
  const riskOff = paperGateSummary.riskMode !== 'NORMAL'

  if (!preview) return { status: 'NO_TRADE', reason: '暂无 execution preview' }
  if (dailyBlocked || weeklyBlocked || riskOff) return { status: 'NO_TRADE', reason: '当前处于全局风险关闭条件' }
  if (preview.executionStatus === 'ALLOW_FULL' && preview.matchReason === 'gate pass + no cap' && enoughSample && profitable && healthyWinRate && preferredEnvironment && preferredStrategy) {
    return { status: 'LIVE_OK', reason: '完全放行 + 样本达标 + 环境策略在真钱白名单' }
  }
  if (preview.executionStatus === 'ALLOW_CAPPED' && preview.matchReason.includes('soft cap') && enoughSample && profitable && healthyWinRate && preferredEnvironment && preferredStrategy) {
    return { status: 'LIVE_SMALL', reason: '允许小仓：soft cap 压缩但样本达标' }
  }
  if (preview.executionStatus === 'BLOCKED_GATE' || preview.executionStatus === 'BLOCKED_BUDGET') {
    return { status: 'NO_TRADE', reason: '当前被 gate / 风险预算拦截' }
  }
  return { status: 'PAPER_ONLY', reason: '当前更适合继续 paper 观察' }
}

function buildAlertBody(signal: DashboardSignal, preview: PaperGatePreview, live: { status: LiveReadiness, reason: string }, sizing: ReturnType<typeof calcSizingSuggestion> | null) {
  const entry = parseEntryRange(signal.entry)
  return [
    `${signal.symbol}｜${live.status === 'LIVE_OK' ? '可下注' : live.status === 'LIVE_SMALL' ? '小仓试单' : live.status === 'NO_TRADE' ? '暂停下注' : '仅做观察'}`,
    `策略：${signal.strategy}`,
    `环境：${signal.environment}`,
    `执行状态：${preview.executionStatus}（${chineseExecutionStatus(preview.executionStatus)}）`,
    `匹配原因：${preview.matchReason}`,
    `入场区间：${entry.low ? `${entry.low.toFixed(2)} - ${entry.high?.toFixed(2)}` : signal.entry}`,
    `止损 / 止盈一：${signal.stopLoss} / ${signal.takeProfit1}`,
    `建议风险 / 名义仓位：${sizing ? `$${sizing.riskUsd.toFixed(2)} / $${sizing.notionalUsd.toFixed(2)}` : '- / -'}`,
    `中文说明：${live.reason}`,
    `Why now：${preview.whyNow}`
  ].join('\n')
}

function buildExecutionStatusStats(trades: PaperTrade[]): ExecutionStatusStat[] {
  const order: ExecutionStatus[] = ['ALLOW_FULL', 'ALLOW_CAPPED', 'RISK_OFF', 'RISK_OFF_CAPPED', 'BLOCKED_GATE', 'BLOCKED_BUDGET']
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

function executionStatusLabel(status: ReturnType<typeof getExecutionStatus>) {
  if (status === 'ALLOW_FULL') return 'ALLOW_FULL'
  if (status === 'ALLOW_CAPPED') return 'ALLOW_CAPPED'
  if (status === 'RISK_OFF') return 'RISK_OFF'
  if (status === 'RISK_OFF_CAPPED') return 'RISK_OFF_CAPPED'
  if (status === 'BLOCKED_BUDGET') return 'BLOCKED_BUDGET'
  return 'BLOCKED_GATE'
}

function executionMatchReason(status: ReturnType<typeof getExecutionStatus>, sizing?: ReturnType<typeof calcSizingSuggestion> | null) {
  if (status === 'ALLOW_FULL') return 'gate pass + no cap'
  if (status === 'ALLOW_CAPPED') return `gate pass + ${sizing?.cappedBy ?? 'cap active'}`
  if (status === 'RISK_OFF') return 'risk-off + uncapped'
  if (status === 'RISK_OFF_CAPPED') return `risk-off + ${sizing?.cappedBy ?? 'cap active'}`
  if (status === 'BLOCKED_BUDGET') return 'blocked by risk budget'
  return 'blocked by gate'
}

function buildGatePreview(signal: DashboardSignal, gate: ReturnType<typeof evaluatePaperTradeGate>, sizing?: ReturnType<typeof calcSizingSuggestion> | null): PaperGatePreview {
  const envMultiplier = environmentPriorityMultiplier(signal.environment)
  const gateBase = !gate.allowed ? 20 : gate.riskMode === 'RISK_OFF' ? 70 : 100
  const sizeFactor = gate.allowed ? ((gate.size ?? 0) / 1) : 0.2
  const priorityScore = Number((gateBase + signal.score * envMultiplier * sizeFactor).toFixed(2))

  const executionStatus = getExecutionStatus(gate, sizing)

  if (!gate.allowed) {
    return {
      verdict: 'BLOCKED',
      executionStatus,
      label: executionStatusLabel(executionStatus),
      detail: gate.reason ?? 'gate blocked',
      priorityScore,
      whyNow: `现在不做：${gate.reason ?? '被 gate 拦截'}。`,
      matchReason: executionMatchReason(executionStatus, sizing)
    }
  }
  if (gate.riskMode === 'RISK_OFF') {
    return {
      verdict: 'RISK_OFF',
      executionStatus,
      label: `${executionStatusLabel(executionStatus)} x${(gate.size ?? 0).toFixed(2)}`,
      detail: `prio=${priorityScore} | size=${(gate.size ?? 0).toFixed(2)} notional=${(gate.notionalUsd ?? 0).toFixed(0)}${sizing && sizing.cappedBy !== 'none' ? ` | ${sizing.capDetail}` : ''}`,
      priorityScore,
      whyNow: `可做但收缩：${environmentWhyNow(signal.environment)}，${scoreWhyNow(signal.score)}，当前处于 risk-off，size 仅 ${(gate.size ?? 0).toFixed(2)}。${sizing && sizing.cappedBy !== 'none' ? ` 另外 ${sizing.capDetail}。` : ''}`,
      matchReason: executionMatchReason(executionStatus, sizing)
    }
  }
  return {
    verdict: 'ALLOW',
    executionStatus,
    label: `${executionStatusLabel(executionStatus)} x${(gate.size ?? 0).toFixed(2)}`,
    detail: `prio=${priorityScore} | size=${(gate.size ?? 0).toFixed(2)} notional=${(gate.notionalUsd ?? 0).toFixed(0)}${sizing && sizing.cappedBy !== 'none' ? ` | ${sizing.capDetail}` : ''}`,
    priorityScore,
    whyNow: `现在值得看：${environmentWhyNow(signal.environment)}，${scoreWhyNow(signal.score)}，当前 gate 放行且 size ${(gate.size ?? 0).toFixed(2)}。${sizing && sizing.cappedBy !== 'none' ? ` 但 ${sizing.capDetail}。` : ''}`,
    matchReason: executionMatchReason(executionStatus, sizing)
  }
}

function evaluatePaperTradeGate(signal: DashboardSignal, trades: PaperTrade[], snapshots: MarketSnapshot[]) {
  const side: PaperTrade['side'] = signal.strategy === '趋势做空' ? 'SHORT' : 'LONG'
  const profile = riskProfileForEnvironment(signal.environment)
  const openTrades = trades.filter((trade) => trade.status === 'OPEN')
  const closedTrades = trades.filter((trade) => trade.status === 'CLOSED')
  const symbolMeta = SYMBOLS.find((item) => item.label === signal.symbol)
  const sector = symbolMeta?.sector ?? 'Other'
  const betaBucket = betaBucketForSymbol(signal.symbol)

  const longExposure = openTrades.filter((trade) => trade.side === 'LONG').reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const shortExposure = openTrades.filter((trade) => trade.side === 'SHORT').reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const strategyExposure = openTrades.filter((trade) => trade.strategy === signal.strategy).reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const sectorSideExposure = openTrades.filter((trade) => (SYMBOLS.find((item) => item.label === trade.symbol)?.sector ?? 'Other') === sector && trade.side === side).reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const betaBucketSideExposure = openTrades.filter((trade) => betaBucketForSymbol(trade.symbol) === betaBucket && trade.side === side).reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)

  const currentEquity = 10000 + closedTrades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
  let peakEquity = 10000
  for (const trade of [...closedTrades].sort((a, b) => new Date(a.closedAt ?? a.createdAt).getTime() - new Date(b.closedAt ?? b.createdAt).getTime())) {
    peakEquity += trade.realizedPnl ?? 0
    peakEquity = Math.max(peakEquity, currentEquity > peakEquity ? currentEquity : peakEquity)
  }
  const drawdown = Math.max(0, peakEquity - currentEquity)
  const todayPnl = closedTrades.filter((trade) => getDayKey(trade.closedAt ?? trade.createdAt) === getDayKey()).reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
  const weekPnl = closedTrades.filter((trade) => getWeekKey(trade.closedAt ?? trade.createdAt) === getWeekKey()).reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)
  const recentClosed = [...closedTrades].sort((a, b) => new Date(b.closedAt ?? b.createdAt).getTime() - new Date(a.closedAt ?? a.createdAt).getTime())
  const lossStreak = recentClosed.findIndex((trade) => (trade.realizedPnl ?? 0) >= 0)
  const normalizedLossStreak = lossStreak === -1 ? recentClosed.length : lossStreak
  let proposedSize = strategyRiskWeight(signal.strategy) * streakRiskMultiplier(normalizedLossStreak)

  if (drawdown >= profile.drawdownHardStopTrigger) return { allowed: false, reason: `触发 hard stop：drawdown ${drawdown.toFixed(2)} >= ${profile.drawdownHardStopTrigger}` }
  if (todayPnl <= profile.dailyLossLimit) return { allowed: false, reason: `触发日损失限制：${todayPnl.toFixed(2)} <= ${profile.dailyLossLimit}` }
  if (weekPnl <= profile.weeklyLossLimit) return { allowed: false, reason: `触发周损失限制：${weekPnl.toFixed(2)} <= ${profile.weeklyLossLimit}` }
  if (openTrades.length >= profile.maxOpenPositions) return { allowed: false, reason: `超过最大持仓数：${openTrades.length}/${profile.maxOpenPositions}` }

  if (drawdown >= profile.drawdownRiskOffTrigger) proposedSize *= 0.5
  const sideExposure = side === 'LONG' ? longExposure : shortExposure
  if (sideExposure + proposedSize > profile.maxSideExposure) return { allowed: false, reason: `side exposure 超限：${(sideExposure + proposedSize).toFixed(2)} > ${profile.maxSideExposure}` }
  if (strategyExposure + proposedSize > profile.maxStrategyExposure) return { allowed: false, reason: `strategy exposure 超限：${(strategyExposure + proposedSize).toFixed(2)} > ${profile.maxStrategyExposure}` }
  if (sectorSideExposure + proposedSize > profile.maxSectorSideExposure) return { allowed: false, reason: `sector-side exposure 超限：${(sectorSideExposure + proposedSize).toFixed(2)} > ${profile.maxSectorSideExposure}` }
  if (betaBucketSideExposure + proposedSize > profile.maxBetaBucketSideExposure) return { allowed: false, reason: `beta bucket exposure 超限：${(betaBucketSideExposure + proposedSize).toFixed(2)} > ${profile.maxBetaBucketSideExposure}` }
  if (proposedSize <= 0.15) return { allowed: false, reason: `risk-throttled size 过小：${proposedSize.toFixed(2)}` }

  const snapshot = snapshots.find((item) => item.symbol === signal.symbol)
  return {
    allowed: true,
    size: proposedSize,
    notionalUsd: 1000 * proposedSize,
    currentPrice: snapshot?.price ?? parsePriceText(signal.entry) ?? 0,
    drawdown,
    todayPnl,
    weekPnl,
    riskMode: drawdown >= profile.drawdownRiskOffTrigger ? 'RISK_OFF' : 'NORMAL'
  }
}

export default function App() {
  const [settings, setSettings] = useState<DashboardSettings>(defaultSettings)
  const [snapshots, setSnapshots] = useState<MarketSnapshot[]>([])
  const [signals, setSignals] = useState<DashboardSignal[]>([])
  const [sectorHeat, setSectorHeat] = useState<SectorHeat[]>([])
  const [fearGreed, setFearGreed] = useState<number>(50)
  const [summary, setSummary] = useState('加载中...')
  const [journal, setJournal] = useState<TradeJournalEntry[]>([])
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([])
  const [backtest, setBacktest] = useState<BacktestResult | null>(null)
  const [reportHistory, setReportHistory] = useState<ResearchReportArchiveItem[]>([])
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ResearchReportArchiveItem | null>(null)
  const [reportDiff, setReportDiff] = useState<ResearchReportDiff | null>(null)
  const [highlightedExecutionStatus, setHighlightedExecutionStatus] = useState<'ALL' | ExecutionStatus>('ALL')
  const [highlightedMatchReason, setHighlightedMatchReason] = useState<'ALL' | string>('ALL')
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([])
  const [alertDedupe, setAlertDedupe] = useState<Record<string, string>>({})
  const [notifierStatus, setNotifierStatus] = useState<{ provider: string; enabled: boolean; configured: boolean; maskedWebhook: string | null } | null>(null)
  const [deliveryLog, setDeliveryLog] = useState<Array<{ ts: string; alertId?: string; title?: string; provider: string; ok: boolean; message?: string | null }>>([])
  const [notifierQueueSummary, setNotifierQueueSummary] = useState<{ pending: number; failed: number; sent: number; acked: number; buffered: number; traderMode?: string; digestPriority?: string; digestWindowMs?: number; configSource?: string; digestBufferCreatedAt?: string | null; nextDigestAt?: string | null; digestItems?: Array<{ id: string; title: string; kind: string; severity?: string; createdAt: string; signature: string }>; retrying: Array<{ id: string; title: string; nextRetryAt?: string | null; retryCount?: number; lastDeliveryError?: string | null }> } | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [highlightedAlertId, setHighlightedAlertId] = useState<string | null>(null)
  const [flushConfirmOpen, setFlushConfirmOpen] = useState(false)
  const [countdownNow, setCountdownNow] = useState(Date.now())
  const [selectedReadinessSymbol, setSelectedReadinessSymbol] = useState<string | null>(null)
  const [readinessRuntimeState, setReadinessRuntimeState] = useState<ReadinessRuntimeState>({ setups: {} })
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [dataSourceStatus, setDataSourceStatus] = useState<{ coingecko?: DataSourceHealth } | null>(null)

  useEffect(() => {
    setSettings(loadSettings())
    setJournal(loadJournal())
    setPaperTrades(loadPaperTrades())
    setAlertDedupe(loadAlertDedupe())
    loadServerAlerts().then(setAlertEvents).catch(() => setAlertEvents([]))
    loadNotifierStatus().then(setNotifierStatus).catch(() => setNotifierStatus(null))
    loadDeliveryLog().then(setDeliveryLog).catch(() => setDeliveryLog([]))
    loadNotifierQueueSummary().then(setNotifierQueueSummary).catch(() => setNotifierQueueSummary(null))
    loadReadinessState().then(setReadinessRuntimeState).catch(() => setReadinessRuntimeState({ setups: {} }))
    const history = loadReportHistory()
    setReportHistory(history)
    setSelectedHistoryItem(history[0] ?? null)
  }, [])

  useEffect(() => {
    saveSettings(settings)
    setRefreshing(true)
    loadDashboardData(settings)
      .then((data) => {
        setSnapshots(data.snapshots)
        setSignals(data.signals)
        setSectorHeat(data.sectorHeat)
        setFearGreed(data.fearGreedValue)
        setSummary(data.environmentSummary)
        setDataSourceStatus(data.dataSourceStatus ?? null)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setRefreshing(false))
  }, [settings, reloadKey])

  useEffect(() => {
    saveJournal(journal)
  }, [journal])

  useEffect(() => {
    savePaperTrades(paperTrades)
  }, [paperTrades])

  useEffect(() => {
    saveAlertDedupe(alertDedupe)
  }, [alertDedupe])

  useEffect(() => {
    if (!snapshots.length) return
    setPaperTrades((prev) => prev.map((trade) => syncPaperTradeWithMarket(trade, snapshots)))
  }, [snapshots])

  const avgFunding = snapshots.length ? snapshots.reduce((sum, item) => sum + (item.fundingRate ?? 0), 0) / snapshots.length : 0
  const topSignal = signals[0]
  const totalMarketCap = useMemo(() => snapshots.reduce((sum, item) => sum + (item.marketCap ?? 0), 0), [snapshots])
  const paperEquityCurve = useMemo(() => buildPaperEquityCurve(paperTrades, settings.accountEquity), [paperTrades, settings.accountEquity])
  const latestPaperEquity = paperEquityCurve[paperEquityCurve.length - 1]?.equityUsd ?? settings.accountEquity
  const totalOpenUnrealizedPnl = useMemo(() => paperTrades.filter((trade) => trade.status === 'OPEN').reduce((sum, trade) => sum + (trade.unrealizedPnl ?? 0), 0), [paperTrades])
  const currentConcurrentRiskUsd = useMemo(() => paperTrades.filter((trade) => trade.status === 'OPEN' && trade.entryPrice && trade.quantity).reduce((sum, trade) => {
    const stop = parsePriceText(trade.stopLoss)
    if (!stop || !trade.entryPrice || !trade.quantity) return sum
    return sum + Math.abs(trade.entryPrice - stop) * trade.quantity
  }, 0), [paperTrades])
  const floatingPaperEquity = latestPaperEquity + totalOpenUnrealizedPnl
  const sizingEquityUsd = settings.sizingMode === 'PAPER_FLOATING_EQUITY'
    ? floatingPaperEquity
    : settings.sizingMode === 'PAPER_EQUITY'
      ? latestPaperEquity
      : settings.accountEquity
  const paperGateSummary = useMemo(() => buildPaperGateSummary(paperTrades, topSignal?.environment), [paperTrades, topSignal])
  const signalGateEvaluations = useMemo(() => Object.fromEntries(signals.map((signal) => [signal.symbol, evaluatePaperTradeGate(signal, paperTrades, snapshots)])), [signals, paperTrades, snapshots])
  const signalSizingSuggestions = useMemo(() => Object.fromEntries(signals.map((signal) => {
    const gate = signalGateEvaluations[signal.symbol]
    return [signal.symbol, calcSizingSuggestion(signal, settings, sizingEquityUsd, currentConcurrentRiskUsd, gate)]
  })), [signals, signalGateEvaluations, settings, sizingEquityUsd, currentConcurrentRiskUsd])
  const signalGatePreviews = useMemo(() => Object.fromEntries(signals.map((signal) => {
    const gate = signalGateEvaluations[signal.symbol]
    const sizing = signalSizingSuggestions[signal.symbol]
    return [signal.symbol, buildGatePreview(signal, gate, sizing)]
  })), [signals, signalGateEvaluations, signalSizingSuggestions])
  const executionStatusStats = useMemo(() => buildExecutionStatusStats(paperTrades), [paperTrades])
  const validationStatsBySetup = useMemo<ValidationStatsMap>(() => buildValidationStatsBySetup(paperTrades, settings.readiness.validationWindowTrades), [paperTrades, settings.readiness.validationWindowTrades])
  const signalReadinessEvaluations = useMemo(() => Object.fromEntries(signals.map((signal) => {
    const preview = signalGatePreviews[signal.symbol]
    const setupKey = buildReadinessSetupKey(signal, preview)
    const runtimeItem = readinessRuntimeState.setups?.[setupKey] ?? null
    const validationStats = validationStatsBySetup[setupKey] ?? null
    return [signal.symbol, evaluateReadinessWithValidationAndRuntime({
      signal,
      preview,
      paperGateSummary,
      executionStats: executionStatusStats,
      readiness: settings.readiness,
      validationStats,
      runtimeItem,
    })]
  })), [signals, signalGatePreviews, paperGateSummary, executionStatusStats, settings.readiness, readinessRuntimeState, validationStatsBySetup])
  const signalLiveReadiness = useMemo(() => Object.fromEntries(signals.map((signal) => {
    const preview = signalGatePreviews[signal.symbol]
    return [signal.symbol, evaluateLiveReadinessDomain(signal, preview, paperGateSummary, executionStatusStats)]
  })), [signals, signalGatePreviews, paperGateSummary, executionStatusStats])
  const enrichedSignals = useMemo(() => signals.map((signal) => ({
    signal,
    preview: signalGatePreviews[signal.symbol],
    live: signalLiveReadiness[signal.symbol],
    readiness: signalReadinessEvaluations[signal.symbol],
    sizing: signalSizingSuggestions[signal.symbol]
  })), [signals, signalGatePreviews, signalLiveReadiness, signalReadinessEvaluations, signalSizingSuggestions])
  const executableSignals = useMemo(() => enrichedSignals
    .filter((item) => item.preview && item.preview.verdict !== 'BLOCKED')
    .sort((a, b) => (b.preview?.priorityScore ?? -999) - (a.preview?.priorityScore ?? -999)), [enrichedSignals])
  const top3Executable = executableSignals.slice(0, 3)
  const top5Executable = executableSignals.slice(0, 5)
  const primaryExecutable = top3Executable[0] ?? null
  const backupExecutables = top3Executable.slice(1, 3)
  const selectedReadinessEvaluation = selectedReadinessSymbol ? signalReadinessEvaluations[selectedReadinessSymbol] : null
  const selectedReadinessSignal = selectedReadinessSymbol ? signals.find((item) => item.symbol === selectedReadinessSymbol) ?? null : null
  const topFocusSymbols = top3Executable.map(({ signal }) => signal.symbol).slice(0, 2)
  const actionModeSummary = paperGateSummary.riskMode === 'HARD_STOP'
    ? '暂停新增风险，只看风险处置'
    : paperGateSummary.riskMode === 'RISK_OFF'
      ? '只允许更克制的小仓试单'
      : top3Executable.some(({ readiness }) => readiness?.finalDecision === 'LIVE_OK')
        ? '允许人工确认后跟进 1 笔高质量机会'
        : top3Executable.some(({ readiness }) => readiness?.finalDecision === 'LIVE_SMALL')
          ? '以观察和小仓试单为主'
          : '今天以观察 / paper 为主'
  const actionGuardrailSummary = paperGateSummary.riskMode === 'HARD_STOP'
    ? '触发 HARD_STOP，停止新增真钱单。'
    : paperGateSummary.riskMode === 'RISK_OFF'
      ? '处于 RISK_OFF，所有机会默认降杠杆、降风险。'
      : `当日损益 ${paperGateSummary.todayPnl.toFixed(2)} / 限制 ${paperGateSummary.dailyLossLimit.toFixed(2)}；本周损益 ${paperGateSummary.weekPnl.toFixed(2)} / 限制 ${paperGateSummary.weeklyLossLimit.toFixed(2)}。`

  useEffect(() => {
    if (!signals.length) return

    syncRuntimeState({
      settings,
      paperTrades,
      paperGateSummary,
      signalGatePreviews,
      signalLiveReadiness,
      signalReadinessEvaluations,
      signalSizingSuggestions,
      signals,
      syncedAt: new Date().toISOString(),
    }).catch(() => {})
  }, [enrichedSignals, signals.length, paperGateSummary, signalReadinessEvaluations])

  useEffect(() => {
    const timer = setInterval(() => {
      loadServerAlerts().then(setAlertEvents).catch(() => {})
      loadDeliveryLog().then(setDeliveryLog).catch(() => {})
      loadNotifierStatus().then(setNotifierStatus).catch(() => {})
      loadNotifierQueueSummary().then(setNotifierQueueSummary).catch(() => {})
      loadReadinessState().then(setReadinessRuntimeState).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => setToastMessage(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  useEffect(() => {
    if (!highlightedAlertId) return
    const timer = window.setTimeout(() => setHighlightedAlertId(null), 8000)
    return () => window.clearTimeout(timer)
  }, [highlightedAlertId])

  useEffect(() => {
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  function getCountdownMeta(nextDigestAt?: string | null) {
    if (!nextDigestAt) return { label: '-', tone: 'countdown-neutral' }
    const diffMs = new Date(nextDigestAt).getTime() - countdownNow
    if (diffMs <= 0) return { label: '即将触发', tone: 'countdown-hot' }
    const totalSec = Math.ceil(diffMs / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    const label = mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`
    const tone = totalSec <= 10 ? 'countdown-hot' : totalSec <= 60 ? 'countdown-warm' : 'countdown-neutral'
    return { label, tone }
  }

  function formatCountdown(nextDigestAt?: string | null) {
    return getCountdownMeta(nextDigestAt).label
  }

  async function runBacktest() {
    setBacktestLoading(true)
    try {
      const previous = reportHistory[0] ?? null
      const result = await loadBacktest(settings)
      setBacktest(result)
      const diff = buildReportDiff(result, previous)
      setReportDiff(diff)
      const archived = archiveBacktestResult(result, 'v12.2')
      const nextHistory = [archived, ...reportHistory].slice(0, 20)
      setReportHistory(nextHistory)
      setSelectedHistoryItem(archived)
      saveReportHistory(nextHistory)
    } finally {
      setBacktestLoading(false)
    }
  }

  function addPaperTrade(signal: DashboardSignal) {
    const side: PaperTrade['side'] = signal.strategy === '趋势做空' ? 'SHORT' : 'LONG'
    const gate = signalGateEvaluations[signal.symbol] ?? evaluatePaperTradeGate(signal, paperTrades, snapshots)
    const preview = signalGatePreviews[signal.symbol]
    const sizing = calcSizingSuggestion(signal, settings, sizingEquityUsd, currentConcurrentRiskUsd, gate, preview)
    const entryPrice = gate.currentPrice ?? parseEntryRange(signal.entry).mid ?? 0
    const notionalUsd = gate.allowed ? (sizing?.notionalUsd ?? gate.notionalUsd ?? 0) : 0
    const quantity = gate.allowed ? (sizing?.quantity ?? (entryPrice > 0 ? notionalUsd / entryPrice : 0)) : 0
    const trade: PaperTrade = {
      id: `${Date.now()}-${signal.symbol}`,
      createdAt: new Date().toISOString(),
      symbol: signal.symbol,
      strategy: signal.strategy,
      environment: signal.environment,
      side,
      signalScore: signal.score,
      entryPlan: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      note: gate.allowed ? `${signal.note} ｜ exec=${preview?.executionStatus ?? 'UNKNOWN'} gate=${gate.riskMode} size=${gate.size?.toFixed(2)} leverage=${settings.leverage} risk$=${sizing?.riskUsd?.toFixed(2) ?? '-'} cap=${sizing?.cappedBy ?? 'none'}` : signal.note,
      status: gate.allowed ? 'OPEN' : 'BLOCKED',
      entryPrice: gate.allowed ? entryPrice : undefined,
      currentPrice: gate.allowed ? entryPrice : undefined,
      quantity,
      notionalUsd,
      unrealizedPnl: 0,
      realizedPnl: 0,
      realizedPnlPct: 0,
      plannedRiskUsd: sizing?.riskUsd ?? 0,
      resultR: 0,
      exitReason: gate.allowed ? undefined : 'BLOCKED',
      gateReason: gate.allowed ? `ALLOW ${gate.riskMode} | DD ${gate.drawdown?.toFixed(2)} | Day ${gate.todayPnl?.toFixed(2)} | Week ${gate.weekPnl?.toFixed(2)}` : gate.reason,
      executionStatus: preview?.executionStatus,
      matchReason: preview?.matchReason,
      readinessDecision: signalReadinessEvaluations[signal.symbol]?.finalDecision,
      readinessSetupKey: buildReadinessSetupKey(signal, preview),
    }
    setPaperTrades((prev) => [trade, ...prev])
  }

  function addJournalFromSignal(signal: DashboardSignal) {
    const side: 'LONG' | 'SHORT' = signal.strategy === '趋势做空' ? 'SHORT' : 'LONG'
    const entry = parseEntryRange(signal.entry).mid ?? 0
    const stop = parsePriceText(signal.stopLoss) ?? 0
    const tp1 = parsePriceText(signal.takeProfit1) ?? entry

    setJournal((prev) => [{
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      symbol: signal.symbol,
      strategy: signal.strategy,
      environment: signal.environment,
      side,
      thesis: `Shortlist candidate · ${signal.note}`,
      entryPrice: entry,
      stopPrice: stop,
      exitPrice: tp1,
      resultR: 0,
      note: `来自 V10.0 cockpit | Gate=${signalGatePreviews[signal.symbol]?.label ?? '-'} | WhyNow=${signalGatePreviews[signal.symbol]?.whyNow ?? '-'}`
    }, ...prev])
  }

  function updatePaperTradeStatus(id: string, status: PaperTrade['status']) {
    let closedTrade: PaperTrade | null = null
    setPaperTrades((prev) => prev.map((trade) => {
      if (trade.id !== id) return trade
      if (status === 'BLOCKED') {
        return {
          ...trade,
          status,
          exitReason: 'BLOCKED',
          unrealizedPnl: 0
        }
      }
      if (status === 'CLOSED' && trade.entryPrice && trade.quantity) {
        const exitPrice = trade.currentPrice ?? trade.entryPrice
        const realizedPnl = calcPnl(trade.side, trade.entryPrice, exitPrice, trade.quantity)
        const realizedPnlPct = trade.notionalUsd ? (realizedPnl / trade.notionalUsd) * 100 : 0
        const resultR = trade.plannedRiskUsd ? realizedPnl / trade.plannedRiskUsd : 0
        const nextTrade = {
          ...trade,
          status,
          exitPrice,
          closedAt: new Date().toISOString(),
          exitReason: trade.exitReason ?? 'MANUAL',
          realizedPnl,
          realizedPnlPct,
          resultR,
          unrealizedPnl: 0
        }
        closedTrade = nextTrade
        return nextTrade
      }
      return { ...trade, status }
    }))

    if (status === 'CLOSED' && closedTrade) {
      const finalizedTrade = closedTrade as PaperTrade
      const setupKey = finalizedTrade.readinessSetupKey ?? `${finalizedTrade.strategy}|${finalizedTrade.environment}|${finalizedTrade.executionStatus ?? 'UNKNOWN'}`
      const readinessDecision = finalizedTrade.readinessDecision ?? (finalizedTrade.executionStatus === 'ALLOW_FULL' ? 'LIVE_OK' : 'LIVE_SMALL')
      updateReadinessStateOnTradeCloseApi({
        setupKey,
        readinessDecision,
        realizedPnl: finalizedTrade.realizedPnl ?? 0,
        cooldownAfterDegradeTrades: settings.readiness.cooldownAfterDegradeTrades,
        liveSmallLossStreakToPaperOnly: settings.readiness.liveSmallLossStreakToPaperOnly,
        liveOkLossStreakToLiveSmall: settings.readiness.liveOkLossStreakToLiveSmall,
        liveOkLossStreakToPaperOnly: settings.readiness.liveOkLossStreakToPaperOnly,
      }).then(() => loadReadinessState().then(setReadinessRuntimeState)).catch(() => {})
    }
  }

  function handleUpdateHistoryItem(id: string, patch: Partial<ResearchReportArchiveItem>) {
    const next = updateReportHistoryItem(reportHistory, id, patch)
    setReportHistory(next)
    saveReportHistory(next)
    if (selectedHistoryItem?.id === id) {
      const updated = next.find((item) => item.id === id) ?? null
      setSelectedHistoryItem(updated)
    }
  }

  function exportScanCsv() {
    return exportToCsv((backtest?.parameterScan ?? []).map((row) => ({
      oversoldThreshold: row.oversoldThreshold,
      trendThreshold: row.trendThreshold,
      holdBars: row.holdBars,
      trades: row.trades,
      winRate: row.winRate.toFixed(2),
      avgR: row.avgR.toFixed(4),
      totalR: row.totalR.toFixed(4),
      maxDrawdownR: row.maxDrawdownR.toFixed(4),
      scoreProfitDrawdown: row.scoreProfitDrawdown.toFixed(4),
      scoreExpectancy: row.scoreExpectancy.toFixed(4)
    })))
  }

  function exportStrategyCsv() {
    return exportToCsv((backtest?.byStrategy ?? []).map((row) => ({
      strategy: row.strategy,
      trades: row.trades,
      priceOnlyR: row.priceOnlyR.toFixed(4),
      fundingR: row.fundingR.toFixed(4),
      totalR: row.totalR.toFixed(4),
      maxDrawdownR: row.maxDrawdownR.toFixed(4)
    })))
  }

  function exportWalkForwardCsv() {
    return exportToCsv((backtest?.walkForward.windows ?? []).map((row) => ({
      windowIndex: row.windowIndex,
      trainStart: row.trainStart,
      trainEnd: row.trainEnd,
      testStart: row.testStart,
      testEnd: row.testEnd,
      selectedBy: row.selectedBy,
      oversoldThreshold: row.bestParams.oversoldThreshold,
      trendThreshold: row.bestParams.trendThreshold,
      holdBars: row.bestParams.holdBars,
      trainTrades: row.trainTrades,
      trainTotalR: row.trainTotalR.toFixed(4),
      testTrades: row.testTrades,
      testWinRate: row.testWinRate.toFixed(2),
      testAvgR: row.testAvgR.toFixed(4),
      testPriceOnlyR: row.testPriceOnlyR.toFixed(4),
      testFundingR: row.testFundingR.toFixed(4),
      testTotalR: row.testTotalR.toFixed(4),
      testMaxDrawdownR: row.testMaxDrawdownR.toFixed(4)
    })))
  }

  function exportReportMarkdown() {
    return exportResearchReportMarkdown(backtest)
  }

  function exportReportHtml() {
    return exportResearchReportHtml(backtest)
  }

  async function handleFlushDigestConfirmed() {
    const bufferedCount = notifierQueueSummary?.digestItems?.length ?? notifierQueueSummary?.buffered ?? 0
    if (!bufferedCount) {
      setFlushConfirmOpen(false)
      setToastMessage('当前 digest buffer 为空，无需 flush。')
      return
    }
    const beforeAlerts = alertEvents.map((item) => item.id)
    const result = await flushDigestNow()
    const nextAlerts = await loadServerAlerts()
    setAlertEvents(nextAlerts)
    setDeliveryLog(await loadDeliveryLog())
    setNotifierStatus(await loadNotifierStatus())
    setNotifierQueueSummary(await loadNotifierQueueSummary())
    setFlushConfirmOpen(false)
    if (result.flushed) {
      const newDigest = nextAlerts.find((item) => !beforeAlerts.includes(item.id) && item.title.includes('[批量摘要')) ?? nextAlerts.find((item) => item.title.includes('[批量摘要'))
      if (newDigest) setHighlightedAlertId(newDigest.id)
      setToastMessage(`Digest flush 完成：${bufferedCount} 条已合成为 1 条摘要。`)
    } else {
      setToastMessage('Digest buffer 当前未 flush（可能为空或已被自动处理）。')
    }
  }

  return (
    <div className="page">
      {toastMessage ? <div className="toast-banner">{toastMessage}</div> : null}
      {flushConfirmOpen ? (
        <div className="modal-backdrop" onClick={() => setFlushConfirmOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>确认立即 flush digest</h3>
              <button className="ghost-btn small-btn" onClick={() => setFlushConfirmOpen(false)}>关闭</button>
            </div>
            <p style={{ marginTop: 0 }}>本次预计会合成 <strong>1</strong> 条 digest，并消费当前 buffer 中的 <strong>{notifierQueueSummary?.digestItems?.length ?? notifierQueueSummary?.buffered ?? 0}</strong> 条 alerts。</p>
            <div className="muted" style={{ marginBottom: 12 }}>这不会改动 trader mode 配置，只会立刻触发一次当前 buffer 的摘要发送。</div>
            <div className="flush-why-box" style={{ marginBottom: 12 }}>
              <div><strong>为什么会被归到同一个 digest</strong></div>
              <div className="muted">当前这些 alerts 都已经进入同一个 digest buffer，所以会按当前 notifier 策略一起汇总发送。</div>
              <div className="muted">Trader Mode：{notifierQueueSummary?.traderMode ?? '-'}</div>
              <div className="muted">Digest Priority：{notifierQueueSummary?.digestPriority ?? '-'}</div>
              <div className="muted">Digest Window：{notifierQueueSummary?.digestWindowMs ? `${Math.round(notifierQueueSummary.digestWindowMs / 1000)}s` : '-'}</div>
              <div className="muted">距离自动 flush：<span className={getCountdownMeta(notifierQueueSummary?.nextDigestAt).tone}>{formatCountdown(notifierQueueSummary?.nextDigestAt)}</span></div>
            </div>
            {notifierQueueSummary?.digestItems?.length ? (
              <div className="flush-preview-list" style={{ marginBottom: 12 }}>
                {notifierQueueSummary.digestItems.map((item, idx) => (
                  <div key={`flush-preview-${item.id}`} className="flush-preview-item">
                    <div><strong>{idx + 1}. {item.title}</strong></div>
                    <div className="muted">{item.kind} · {item.severity ?? '-'} · {item.createdAt}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="tag-row">
              <button className="ghost-btn small-btn" onClick={() => setFlushConfirmOpen(false)}>取消</button>
              <button className="ghost-btn small-btn danger-btn" onClick={handleFlushDigestConfirmed}>确认 flush</button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="hero">
        <div>
          <h1>Crypto Contract Dashboard MVP</h1>
          <p>{summary}</p>
        </div>
        <div className="hero-actions">
          <div className="badge">定位：人工辅助下单驾驶舱，不做自动下单</div>
          <button className="ghost-btn" onClick={() => setReloadKey((x) => x + 1)}>
            {refreshing ? '刷新中...' : '刷新数据'}
          </button>
        </div>
      </header>

      {error ? <div className="card error">数据加载失败：{error}</div> : null}
      {dataSourceStatus?.coingecko?.degraded ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h3>部分数据模式</h3>
            <span className="muted">CoinGecko 降级中</span>
          </div>
          <div className="muted">市值 / 排名数据暂不可用，当前继续使用 Binance 核心行情、信号、风控与告警链路运行。</div>
          {dataSourceStatus.coingecko.reason ? <div className="muted" style={{ marginTop: 6 }}>原因：{dataSourceStatus.coingecko.reason}</div> : null}
          {dataSourceStatus.coingecko.lastSuccessAt ? <div className="muted" style={{ marginTop: 6 }}>CoinGecko 最近一次成功：{dataSourceStatus.coingecko.lastSuccessAt}</div> : null}
        </div>
      ) : null}

      <section className="layer-block decision-layer">
        <div className="layer-header">
          <div>
            <h2>第 1 层 · 决策层</h2>
            <p>先回答三件事：今天能不能做、最该看谁、如果做该怎么做。</p>
          </div>
        </div>
        <div className="card trade-summary-bar">
          <div className="trade-summary-main">
            <div className="trade-summary-block trade-summary-block-primary">
              <div className="panel-header">
                <h3>今日交易摘要</h3>
                <div className={`readiness-chip readiness-${paperGateSummary.riskMode === 'HARD_STOP' ? 'no_trade' : paperGateSummary.riskMode === 'RISK_OFF' ? 'paper_only' : top3Executable.some(({ readiness }) => readiness?.finalDecision === 'LIVE_OK') ? 'live_ok' : top3Executable.some(({ readiness }) => readiness?.finalDecision === 'LIVE_SMALL') ? 'live_small' : 'paper_only'}`}>
                  {paperGateSummary.riskMode}
                </div>
              </div>
              <div className="trade-summary-headline">{actionModeSummary}</div>
              <div className="muted">{actionGuardrailSummary}</div>
              <div className="muted" style={{ marginTop: 6 }}>重点关注：{topFocusSymbols.length ? topFocusSymbols.join(' / ') : '暂无高优先级机会'}</div>
            </div>

            <div className="trade-summary-block">
              <div className="trade-summary-label">风险状态</div>
              <div className="trade-summary-metrics">
                <div><span className="muted">Open</span><strong>{paperGateSummary.openPositions} / {paperGateSummary.maxOpenPositions}</strong></div>
                <div><span className="muted">Today</span><strong>{paperGateSummary.todayPnl.toFixed(2)}</strong></div>
                <div><span className="muted">Week</span><strong>{paperGateSummary.weekPnl.toFixed(2)}</strong></div>
                <div><span className="muted">DD</span><strong>{paperGateSummary.drawdown.toFixed(2)}</strong></div>
              </div>
              <div className="muted">Last Decision：{paperGateSummary.lastDecision ?? '-'}</div>
            </div>

            <div className="trade-summary-block">
              <div className="trade-summary-label">30 秒动作</div>
              <div className="trade-summary-steps muted">
                <div>1. 先看 Risk Mode</div>
                <div>2. 再看主机会 Why now</div>
                <div>3. 只复核 LIVE_OK / LIVE_SMALL</div>
                <div>4. 自己确认 entry / stop / 仓位</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {(highlightedExecutionStatus !== 'ALL' || highlightedMatchReason !== 'ALL') ? (
        <div className="sticky-context-bar">
          <div className="sticky-context-inner">
            <span className="muted">V12.2 Sticky Context</span>
            {highlightedExecutionStatus !== 'ALL' ? <button className="drilldown-chip" onClick={() => setHighlightedExecutionStatus('ALL')}>status: {highlightedExecutionStatus} ×</button> : null}
            {highlightedMatchReason !== 'ALL' ? <button className="drilldown-chip" onClick={() => setHighlightedMatchReason('ALL')}>reason: {highlightedMatchReason} ×</button> : null}
            <button className="drilldown-chip clear-all-chip" onClick={() => {
              setHighlightedExecutionStatus('ALL')
              setHighlightedMatchReason('ALL')
            }}>清空全部 drill-down</button>
            <span className="muted">{highlightedExecutionStatus !== 'ALL' && highlightedMatchReason !== 'ALL' ? '当前为 status + reason 交集' : highlightedExecutionStatus !== 'ALL' ? '当前只按 status' : '当前只按 reason'}</span>
          </div>
        </div>
      ) : null}

      <section className="layer-block decision-layer">
        {highlightedExecutionStatus !== 'ALL' || highlightedMatchReason !== 'ALL' ? (
          <>
            <div className="logic-highlight-banner">Drill-down 联动高亮：{highlightedExecutionStatus !== 'ALL' && highlightedMatchReason !== 'ALL' ? `${highlightedExecutionStatus} + ${highlightedMatchReason}` : highlightedExecutionStatus !== 'ALL' ? highlightedExecutionStatus : highlightedMatchReason}</div>
            <div className="drilldown-chipbar global-drilldown-chipbar">
              <span className="muted">V11.8 Global Drill-down</span>
              {highlightedExecutionStatus !== 'ALL' ? <button className="drilldown-chip" onClick={() => setHighlightedExecutionStatus('ALL')}>status: {highlightedExecutionStatus} ×</button> : null}
              {highlightedMatchReason !== 'ALL' ? <button className="drilldown-chip" onClick={() => setHighlightedMatchReason('ALL')}>reason: {highlightedMatchReason} ×</button> : null}
              <span className="muted">{highlightedExecutionStatus !== 'ALL' && highlightedMatchReason !== 'ALL' ? '当前为 status + reason 交集' : highlightedExecutionStatus !== 'ALL' ? '当前只按 status' : '当前只按 reason'}</span>
            </div>
          </>
        ) : null}

        {primaryExecutable ? (() => {
          const { signal, preview, readiness } = primaryExecutable
          const entry = parseEntryRange(signal.entry)
          const rr = calcRoughRiskReward(signal)
          const gate = signalGateEvaluations[signal.symbol]
          const sizing = calcSizingSuggestion(signal, settings, sizingEquityUsd, currentConcurrentRiskUsd, gate, preview)
          const readinessReason = readiness?.degradeReason ?? readiness?.validationReasons?.[0] ?? readiness?.hardBlockReasons?.[0] ?? readiness?.softBlockReasons?.[0] ?? readiness?.fullReadyChecks?.find((item) => !item.passed)?.message ?? readiness?.trialReadyChecks?.find((item) => !item.passed)?.message ?? 'ready'
          const readinessChips = getReadinessSummaryChips(readiness)
          const direction = getTradeDirection(signal)
          const executionCommand = readiness?.finalDecision === 'LIVE_OK'
            ? { icon: '🟢', shortText: '可下注', text: '可下注，先复核后动手', tone: 'ok' }
            : readiness?.finalDecision === 'LIVE_SMALL'
              ? { icon: '🟡', shortText: '小仓试单', text: '只做小仓试单', tone: 'small' }
              : readiness?.finalDecision === 'NO_TRADE'
                ? { icon: '🔴', shortText: '暂停', text: '暂停，不开新风险', tone: 'stop' }
                : { icon: '⚪', shortText: '观察', text: '继续观察，不急着出手', tone: 'watch' }
          return (
            <div className={`card cockpit-hero ${((highlightedExecutionStatus !== 'ALL' && preview?.executionStatus === highlightedExecutionStatus) || (highlightedMatchReason !== 'ALL' && preview?.matchReason === highlightedMatchReason)) ? 'logic-highlight-card' : ''}`}>
              <div className="hero-title-strip">
                <div className={`execution-command execution-command-${executionCommand.tone}`}>{executionCommand.icon} {executionCommand.shortText}</div>
                <div className="hero-title-symbol">{signal.symbol}</div>
                <div className="hero-title-direction">{direction.label}</div>
              </div>
              <div className="panel-header">
                <div>
                  <div className="muted">主机会 / Top 1</div>
                  <div className="muted">执行口令：{executionCommand.text}</div>
                  <div className="muted">{signal.environment} / {signal.strategy}</div>
                </div>
                <div className="tag-row">
                  <div className={`readiness-chip readiness-${(readiness?.finalDecision ?? 'PAPER_ONLY').toLowerCase()}`}>{readiness?.finalDecision ?? 'PAPER_ONLY'}</div>
                  {readinessChips.map((chip) => <div key={`${signal.symbol}-${chip.label}`} title={chip.tooltip} className={`summary-chip ${chip.tone === 'downgrade' ? 'summary-chip-downgrade' : 'summary-chip-validation'}`}>{chip.label}</div>)}
                  <button className="ghost-btn small-btn" onClick={() => setSelectedReadinessSymbol(signal.symbol)}>详情</button>
                </div>
              </div>
              {((highlightedExecutionStatus !== 'ALL' && preview?.executionStatus === highlightedExecutionStatus) || (highlightedMatchReason !== 'ALL' && preview?.matchReason === highlightedMatchReason)) ? <div className="match-reason-tag">{preview.matchReason}</div> : null}
              <div className="grid four cockpit-metrics" style={{ marginTop: 12 }}>
                <div><span className="muted">方向</span><strong>{direction.label}</strong></div>
                <div><span className="muted">Gate</span><strong>{preview?.label}</strong></div>
                <div><span className="muted">Entry Zone</span><strong>{entry.low ? `${entry.low.toFixed(2)} - ${entry.high?.toFixed(2)}` : signal.entry}</strong></div>
                <div><span className="muted">粗略 RR</span><strong>{rr ? rr.toFixed(2) : '-'}</strong></div>
              </div>
              <div className="grid three cockpit-metrics secondary">
                <div><span className="muted">Stop</span><strong>{signal.stopLoss}</strong></div>
                <div><span className="muted">TP1</span><strong>{signal.takeProfit1}</strong></div>
                <div><span className="muted">TP2</span><strong>{signal.takeProfit2}</strong></div>
              </div>
              <div className="grid four cockpit-metrics secondary">
                <div><span className="muted">Position Sizing</span><strong>{sizing ? sizing.quantity.toFixed(4) : '-'}</strong></div>
                <div><span className="muted">Notional Suggestion</span><strong>{sizing ? `$${sizing.notionalUsd.toFixed(2)}` : '-'}</strong></div>
                <div><span className="muted">Risk $</span><strong>{sizing ? `$${sizing.riskUsd.toFixed(2)}` : '-'}</strong></div>
                <div><span className="muted">Sizing Equity × Lev</span><strong>{`$${sizingEquityUsd.toFixed(0)} × ${settings.leverage}`}</strong></div>
              </div>
              <div className="grid four cockpit-metrics secondary">
                <div><span className="muted">Pre-cap Risk</span><strong>{sizing ? `$${sizing.preCapRiskUsd.toFixed(2)}` : '-'}</strong></div>
                <div><span className="muted">Concurrent Risk</span><strong>{`$${currentConcurrentRiskUsd.toFixed(2)}`}</strong></div>
                <div><span className="muted">Remaining Budget</span><strong>{sizing ? `$${sizing.remainingConcurrentRiskUsd.toFixed(2)}` : '-'}</strong></div>
                <div><span className="muted">Cap Status</span><strong>{sizing?.capDetail ?? '-'}</strong></div>
              </div>
              <div className="why-now">Why now: {preview?.whyNow}</div>
              <div className="muted readiness-explain">Readiness: {readinessReason}</div>
              <div className="tag-row" style={{ marginTop: 14 }}>
                <button className="ghost-btn small-btn" onClick={() => addPaperTrade(signal)}>加入 Paper</button>
                <button className="ghost-btn small-btn" onClick={() => addJournalFromSignal(signal)}>加入 Journal</button>
              </div>
            </div>
          )
        })() : (
          <div className="card"><div className="muted">暂无主机会，今天以观察 / paper 为主。</div></div>
        )}

        <div className="decision-below-hero">
          <div className="card shortlist-card">
            <div className="panel-header">
              <h3>备选机会</h3>
              <span className="muted">只保留 2 个，避免分散注意力</span>
            </div>
            <div className="shortlist-list backup-list-tight">
              {backupExecutables.length ? backupExecutables.map(({ signal, preview, readiness }, idx) => {
                const readinessReason = readiness?.degradeReason ?? readiness?.validationReasons?.[0] ?? readiness?.hardBlockReasons?.[0] ?? readiness?.softBlockReasons?.[0] ?? readiness?.fullReadyChecks?.find((item) => !item.passed)?.message ?? readiness?.trialReadyChecks?.find((item) => !item.passed)?.message ?? 'ready'
                const readinessChips = getReadinessSummaryChips(readiness)
                return (
                  <div key={`backup-${signal.symbol}`} className={`shortlist-item compact backup-item ${((highlightedExecutionStatus !== 'ALL' && preview?.executionStatus === highlightedExecutionStatus) || (highlightedMatchReason !== 'ALL' && preview?.matchReason === highlightedMatchReason)) ? 'logic-highlight-card' : ''}`}>
                    <div className="shortlist-rank">#{idx + 2}</div>
                    <div className="shortlist-main">
                      <div><strong>{signal.symbol}</strong> <span className={preview?.executionStatus === 'ALLOW_FULL' ? 'pos' : preview?.executionStatus?.includes('BLOCKED') ? 'neg' : 'muted'}>{preview?.label}</span></div>
                      <div className="tag-row">
                        <div className={`readiness-chip readiness-${(readiness?.finalDecision ?? 'PAPER_ONLY').toLowerCase()}`}>{readiness?.finalDecision ?? 'PAPER_ONLY'}</div>
                        {readinessChips.map((chip) => <div key={`${signal.symbol}-${chip.label}`} title={chip.tooltip} className={`summary-chip ${chip.tone === 'downgrade' ? 'summary-chip-downgrade' : 'summary-chip-validation'}`}>{chip.label}</div>)}
                        <button className="ghost-btn small-btn" onClick={() => setSelectedReadinessSymbol(signal.symbol)}>详情</button>
                      </div>
                      <div className="muted">{signal.environment} · {signal.strategy} · Prio {preview?.priorityScore.toFixed(2)}</div>
                      <div className="why-now compact">{preview?.whyNow}</div>
                      <div className="muted readiness-explain">Why not Top 1: {readinessReason}</div>
                    </div>
                  </div>
                )
              }) : <div className="muted">暂无备选机会。</div>}
            </div>
          </div>

          <details className="card decision-mini-card candidate-pool-collapse">
            <summary><strong>扩展候选池</strong> <span className="muted">前 5 名，默认收起</span></summary>
            <div className="shortlist-list" style={{ marginTop: 12 }}>
              {top5Executable.length ? top5Executable.map(({ signal, preview }, idx) => (
                <div key={`top5-mini-${signal.symbol}`} className="shortlist-item compact">
                  <div className="shortlist-rank">#{idx + 1}</div>
                  <div className="shortlist-main">
                    <div><strong>{signal.symbol}</strong> <span className="muted">{preview?.label}</span></div>
                    <div className="muted">{signal.environment} · {signal.strategy}</div>
                  </div>
                </div>
              )) : <div className="muted">暂无候选机会。</div>}
            </div>
          </details>
        </div>
      </section>

      <section className="layer-block support-layer">
        <div className="layer-header">
          <div>
            <h2>第 2 层 · 辅助判断层</h2>
            <p>这里看告警上下文、readiness 细节和更完整的候选解释，不抢首屏决策视线。</p>
          </div>
        </div>
        {alertEvents.length ? (
          <section>
            <div className="card">
              <div className="panel-header">
                <h3>告警预览 / 最近提醒</h3>
                <span className="muted">正式主链路为 app-native Feishu webhook notifier；这里展示最近 alert 内容与状态。</span>
              </div>
              <div className="alert-feed">
                {alertEvents.slice(0, 8).map((item) => {
                  const alertSymbol = extractSymbolFromAlertTitle(item.title)
                  const alertReadiness = alertSymbol ? signalReadinessEvaluations[alertSymbol] : null
                  const alertReadinessReason = alertReadiness?.degradeReason ?? alertReadiness?.validationReasons?.[0] ?? alertReadiness?.hardBlockReasons?.[0] ?? alertReadiness?.softBlockReasons?.[0] ?? alertReadiness?.fullReadyChecks?.find((check) => !check.passed)?.message ?? alertReadiness?.trialReadyChecks?.find((check) => !check.passed)?.message ?? null
                  const alertReadinessChips = getReadinessSummaryChips(alertReadiness)
                  return (
                  <div key={item.id} className={`alert-item ${highlightedAlertId === item.id ? 'alert-item-flash' : ''}`}>
                    <div className="panel-header">
                      <div>
                        <div><strong>{item.title}</strong></div>
                        <div className="muted">状态：{getAlertStatusLabel(item)}</div>
                        {alertReadiness ? (
                          <div className="tag-row" style={{ marginTop: 6 }}>
                            <div className={`readiness-chip readiness-${alertReadiness.finalDecision.toLowerCase()}`}>{alertReadiness.finalDecision}</div>
                            {alertReadinessChips.map((chip) => <div key={`${item.id}-${chip.label}`} title={chip.tooltip} className={`summary-chip ${chip.tone === 'downgrade' ? 'summary-chip-downgrade' : 'summary-chip-validation'}`}>{chip.label}</div>)}
                            {alertSymbol ? <button className="ghost-btn small-btn" onClick={() => setSelectedReadinessSymbol(alertSymbol)}>详情</button> : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="tag-row">
                        <button className="ghost-btn small-btn" onClick={async () => { await markServerAlertSent(item.id); setAlertEvents(await loadServerAlerts()) }}>标记已发送</button>
                        <button className="ghost-btn small-btn" onClick={async () => { await ackServerAlert(item.id); setAlertEvents(await loadServerAlerts()) }}>确认/归档</button>
                      </div>
                    </div>
                    {alertReadinessReason ? <div className="muted readiness-explain">Readiness: {alertReadinessReason}</div> : null}
                    <pre className="alert-body">{item.body}</pre>
                  </div>
                )})}
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid two">
        <PaperTradingPanel topSignal={topSignal} trades={paperTrades} equityCurve={paperEquityCurve} gateSummary={paperGateSummary} executionStats={executionStatusStats} readinessRuntimeState={readinessRuntimeState} validationStatsBySetup={validationStatsBySetup} onSelectExecutionStatus={setHighlightedExecutionStatus} onSelectMatchReason={setHighlightedMatchReason} onAddTrade={addPaperTrade} onUpdateStatus={updatePaperTradeStatus} />
        <div className="card">
          <div className="panel-header">
            <h3>Readiness Detail</h3>
            <span className="muted">{selectedReadinessSignal ? `${selectedReadinessSignal.symbol} · ${selectedReadinessSignal.environment} / ${selectedReadinessSignal.strategy}` : '点击上方“详情”查看完整判定链'}</span>
          </div>
          {selectedReadinessEvaluation ? (
            <div className="readiness-detail-panel">
              <div className="tag-row" style={{ marginBottom: 12 }}>
                <div className={`readiness-chip readiness-${selectedReadinessEvaluation.finalDecision.toLowerCase()}`}>{selectedReadinessEvaluation.finalDecision}</div>
                <button className="ghost-btn small-btn" onClick={() => setSelectedReadinessSymbol(null)}>清空</button>
              </div>
              <div className="readiness-detail-group">
                <h4>Downgrade State</h4>
                <div className="muted">setupKey：{selectedReadinessEvaluation.setupKey ?? '-'}</div>
                <div className="muted">baseDecision：{selectedReadinessEvaluation.baseDecision ?? selectedReadinessEvaluation.finalDecision}</div>
                <div className="muted">effectiveDecision：{selectedReadinessEvaluation.effectiveDecision ?? selectedReadinessEvaluation.finalDecision}</div>
                <div className="muted">forcedMaxDecision：{selectedReadinessEvaluation.forcedMaxDecision ?? '无'}</div>
                <div className="muted">cooldownRemainingTrades：{selectedReadinessEvaluation.cooldownRemainingTrades ?? 0}</div>
                <div className="muted">degradeReason：{selectedReadinessEvaluation.degradeReason ?? '无'}</div>
              </div>
              <div className="readiness-detail-group">
                <h4>Hard Block Reasons</h4>
                {selectedReadinessEvaluation.hardBlockReasons.length ? selectedReadinessEvaluation.hardBlockReasons.map((reason, idx) => <div key={`hb-${idx}`} className="readiness-detail-item neg">• {reason}</div>) : <div className="muted">无</div>}
              </div>
              <div className="readiness-detail-group">
                <h4>Soft Block Reasons</h4>
                {selectedReadinessEvaluation.softBlockReasons.length ? selectedReadinessEvaluation.softBlockReasons.map((reason, idx) => <div key={`sb-${idx}`} className="readiness-detail-item">• {reason}</div>) : <div className="muted">无</div>}
              </div>
              <div className="readiness-detail-group">
                <h4>Validation</h4>
                {selectedReadinessEvaluation.validationReasons?.length ? (
                  <div className="readiness-reason-box" style={{ marginBottom: 10 }}>
                    {selectedReadinessEvaluation.validationReasons.map((reason, idx) => <div key={`vr-${idx}`} className="readiness-detail-item">• {reason}</div>)}
                  </div>
                ) : <div className="muted" style={{ marginBottom: 10 }}>当前没有 validation gating 限制。</div>}
                {selectedReadinessEvaluation.validationStats ? (
                  <>
                    <div className="muted">sampleCount：{selectedReadinessEvaluation.validationStats.sampleCount}</div>
                    <div className="muted">winRate：{selectedReadinessEvaluation.validationStats.winRate.toFixed(2)}%</div>
                    <div className="muted">realizedPnl：{selectedReadinessEvaluation.validationStats.realizedPnl.toFixed(2)}</div>
                    <div className="muted">avgRealizedPnl：{selectedReadinessEvaluation.validationStats.avgRealizedPnl.toFixed(2)}</div>
                    <div className="muted">avgResultR：{selectedReadinessEvaluation.validationStats.avgResultR.toFixed(2)}</div>
                    <div className="muted">totalResultR：{selectedReadinessEvaluation.validationStats.totalResultR.toFixed(2)}</div>
                    <div className="muted">lossStreak：{selectedReadinessEvaluation.validationStats.lossStreak}</div>
                    <div className="muted">maxLossStreak：{selectedReadinessEvaluation.validationStats.maxLossStreak}</div>
                    <div className="muted">drawdownProxy：{selectedReadinessEvaluation.validationStats.drawdownProxy.toFixed(2)}</div>
                    <div className="muted">drawdownR：{selectedReadinessEvaluation.validationStats.drawdownR.toFixed(2)}</div>
                  </>
                ) : <div className="muted">暂无 validation stats</div>}
              </div>
              <div className="readiness-detail-group">
                <h4>Trial Ready Checks</h4>
                {selectedReadinessEvaluation.trialReadyChecks.length ? selectedReadinessEvaluation.trialReadyChecks.map((check) => <div key={check.key} className={`readiness-detail-item ${check.passed ? 'pos' : 'neg'}`}>{check.passed ? '✓' : '✕'} {check.key} · {check.message}</div>) : <div className="muted">无</div>}
              </div>
              <div className="readiness-detail-group">
                <h4>Full Ready Checks</h4>
                {selectedReadinessEvaluation.fullReadyChecks.length ? selectedReadinessEvaluation.fullReadyChecks.map((check) => <div key={check.key} className={`readiness-detail-item ${check.passed ? 'pos' : 'neg'}`}>{check.passed ? '✓' : '✕'} {check.key} · {check.message}</div>) : <div className="muted">无</div>}
              </div>
            </div>
          ) : <div className="muted">还没有选中的 signal。你可以点 Top 3 / Top 5 卡片上的“详情”。</div>}
        </div>
      </section>

      </section>

      <section className="layer-block ops-layer">
        <div className="layer-header">
          <div>
            <h2>第 3 层 · 运维 / 研究层</h2>
            <p>排查、回测、全量信号和配置都放这里，避免干扰首页第一判断。</p>
          </div>
        </div>

        <section>
          <SignalTable signals={signals} gatePreviews={signalGatePreviews} readinessEvaluations={signalReadinessEvaluations} highlightedExecutionStatus={highlightedExecutionStatus} highlightedMatchReason={highlightedMatchReason} onClearExecutionStatus={() => setHighlightedExecutionStatus('ALL')} onClearMatchReason={() => setHighlightedMatchReason('ALL')} onAddPaperTrade={addPaperTrade} onOpenReadinessDetail={setSelectedReadinessSymbol} />
        </section>

        <section>
          <div className="card">
          <div className="panel-header">
            <h3>Feishu Notifier / Queue 面板</h3>
            <div className="tag-row">
              <button className="ghost-btn small-btn" onClick={async () => {
                await testNotifierSend()
                setDeliveryLog(await loadDeliveryLog())
                setNotifierStatus(await loadNotifierStatus())
                setNotifierQueueSummary(await loadNotifierQueueSummary())
              }}>测试发送</button>
              <button className="ghost-btn small-btn" onClick={() => {
                const bufferedCount = notifierQueueSummary?.digestItems?.length ?? notifierQueueSummary?.buffered ?? 0
                if (!bufferedCount) {
                  setToastMessage('当前 digest buffer 为空，无需 flush。')
                  return
                }
                setFlushConfirmOpen(true)
              }}>立即 flush digest（预计 ${notifierQueueSummary?.digestItems?.length ?? notifierQueueSummary?.buffered ?? 0}→1）</button>
            </div>
          </div>
          <div className="muted" style={{ marginBottom: 12 }}>这块现在退到第二优先级：用于确认提醒是否成功发出，以及排查 queue / retry / digest 状态。</div>
          <div className="grid three calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">Provider</span><strong>{notifierStatus?.provider ?? '-'}</strong></div>
            <div><span className="muted">Configured / Enabled</span><strong>{`${notifierStatus?.configured ? 'YES' : 'NO'} / ${notifierStatus?.enabled ? 'YES' : 'NO'}`}</strong></div>
            <div><span className="muted">Webhook</span><strong>{notifierStatus?.maskedWebhook ?? '未配置'}</strong></div>
          </div>
          <div className="grid five calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">Pending</span><strong>{notifierQueueSummary?.pending ?? 0}</strong></div>
            <div><span className="muted">Buffered</span><strong>{notifierQueueSummary?.buffered ?? 0}</strong></div>
            <div><span className="muted">实际 Failed</span><strong>{Math.max(0, (notifierQueueSummary?.failed ?? 0) - (notifierQueueSummary?.buffered ?? 0))}</strong></div>
            <div><span className="muted">Sent</span><strong>{notifierQueueSummary?.sent ?? 0}</strong></div>
            <div><span className="muted">Acked</span><strong>{notifierQueueSummary?.acked ?? 0}</strong></div>
          </div>
          <div className="grid three calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">Trader Mode</span><strong>{notifierQueueSummary?.traderMode ?? '-'}</strong></div>
            <div><span className="muted">Digest Priority</span><strong>{notifierQueueSummary?.digestPriority ?? '-'}</strong></div>
            <div><span className="muted">Digest Window</span><strong>{notifierQueueSummary?.digestWindowMs ? `${Math.round(notifierQueueSummary.digestWindowMs / 1000)}s` : '-'}</strong></div>
          </div>
          <div className="grid three calc-results" style={{ marginBottom: 12 }}>
            <div><span className="muted">Config Source</span><strong>{notifierQueueSummary?.configSource ?? '-'}</strong></div>
            <div><span className="muted">Buffer Created</span><strong>{notifierQueueSummary?.digestBufferCreatedAt ?? '-'}</strong></div>
            <div><span className="muted">Next Digest ETA</span><strong>{notifierQueueSummary?.nextDigestAt ? <span className={getCountdownMeta(notifierQueueSummary.nextDigestAt).tone}>{`${notifierQueueSummary.nextDigestAt}（剩余 ${formatCountdown(notifierQueueSummary.nextDigestAt)}）`}</span> : '-'}</strong></div>
          </div>
          <div className="panel-header">
            <h4>Digest 明细面板</h4>
            <span className="muted">当前正在 buffer、等待摘要发送的 alerts</span>
          </div>
          {notifierQueueSummary?.digestItems?.length ? (
            <div className="alert-feed" style={{ marginBottom: 12 }}>
              {notifierQueueSummary.digestItems.map((item) => (
                <div key={item.id} className="alert-item">
                  <div className="panel-header">
                    <div><strong>{item.title}</strong></div>
                    <div className="muted">{item.kind} · {item.severity ?? '-'}</div>
                  </div>
                  <div className="muted">进入 buffer：{item.createdAt}</div>
                  <div className="muted">signature：{item.signature}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ marginBottom: 12 }}>当前 digest buffer 为空。</div>
          )}
          {notifierQueueSummary?.retrying?.length ? (
            <div className="alert-feed" style={{ marginBottom: 12 }}>
              {notifierQueueSummary.retrying.map((item) => (
                <div key={item.id} className="alert-item">
                  <div className="panel-header">
                    <div><strong>{item.title}</strong></div>
                    <div className="muted">重试中 × {item.retryCount ?? 0}</div>
                  </div>
                  <div className="muted">下次重试：{item.nextRetryAt ?? '-'}</div>
                  <div className="muted">{item.lastDeliveryError?.includes('buffered for') ? '状态说明' : '错误'}：{item.lastDeliveryError ?? '-'}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="alert-feed">
            {deliveryLog.slice(0, 5).map((item, idx) => {
              const delivery = getDeliveryDisplay(item)
              return (
              <div key={`${item.ts}-${idx}`} className="alert-item">
                <div className="panel-header">
                  <div><strong>{item.title ?? 'delivery log'}</strong></div>
                  <div className={delivery.className}>{delivery.label}</div>
                </div>
                <div className="muted">{item.ts} · {item.provider}</div>
                <div className="muted">{item.message ?? '-'}</div>
              </div>
            )})}
            {!deliveryLog.length ? <div className="muted">暂无 delivery log。</div> : null}
          </div>
        </div>
      </section>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary><strong>研究与配置区（MVP 次优先级）</strong> <span className="muted">设置、回测、研究报告、历史、市场快照、Journal 都收在这里</span></summary>
        <section className="grid five" style={{ marginTop: 16 }}>
          <KpiCard title="恐慌贪婪指数" value={fearGreed} sub={fearGreed < 30 ? '偏恐慌' : fearGreed > 65 ? '偏贪婪' : '中性'} />
          <KpiCard title="平均资金费率" value={`${(avgFunding * 100).toFixed(4)}%`} sub="当前市场快照" />
          <KpiCard title="最强候选" value={topSignal ? topSignal.symbol : '-'} sub={topSignal ? `${topSignal.strategy} / ${topSignal.score}分` : '等待数据'} />
          <KpiCard title="Paper Equity" value={`$${latestPaperEquity.toFixed(2)}`} sub={`${paperTrades.filter((t) => t.status === 'OPEN').length} OPEN / ${paperTrades.length} 总纸上交易`} />
          <KpiCard title="Sizing Equity" value={`$${sizingEquityUsd.toFixed(2)}`} sub={settings.sizingMode === 'PAPER_FLOATING_EQUITY' ? `Floating Equity（含未实现 ${totalOpenUnrealizedPnl.toFixed(2)}）` : settings.sizingMode === 'PAPER_EQUITY' ? '跟随 Paper Equity（仅已实现）' : '固定 Base Capital'} />
        </section>

        <section className="grid two">
          <SettingsPanel settings={settings} onChange={setSettings} />
          <PositionCalculator defaultRiskPct={settings.perTradeRiskPct} defaultLeverage={settings.leverage} />
        </section>

        <section className="grid two">
          <RotationChart snapshots={snapshots} />
          <SectorHeatTable sectors={sectorHeat} />
        </section>

        <section>
          <BacktestPanel
            result={backtest}
            loading={backtestLoading}
            onRun={runBacktest}
            onExportScan={exportScanCsv}
            onExportStrategy={exportStrategyCsv}
            onExportWalkForward={exportWalkForwardCsv}
          />
        </section>

        <section>
          <ResearchReportPanel
            result={backtest}
            onExportMarkdown={exportReportMarkdown}
            onExportHtml={exportReportHtml}
          />
        </section>

        <section>
          <HistoricalReportViewer item={selectedHistoryItem} />
        </section>

        <section>
          <ReportHistoryPanel
            history={reportHistory}
            diff={reportDiff}
            onUpdateItem={handleUpdateHistoryItem}
            onSelectItem={setSelectedHistoryItem}
            selectedId={selectedHistoryItem?.id ?? null}
          />
        </section>

        <section className="card">
          <h3>市场快照</h3>
          <div className="grid snapshot-grid">
            {snapshots.map((item) => (
              <div key={item.symbol} className="snapshot-item">
                <strong>{item.symbol}</strong>
                <span>Price: {item.price.toFixed(2)}</span>
                <span className={item.change24h >= 0 ? 'pos' : 'neg'}>24h: {item.change24h.toFixed(2)}%</span>
                <span>20D 偏离: {(item.ma20DiffPct ?? 0).toFixed(2)}%</span>
                <span>30D 偏离: {(item.ma30DiffPct ?? 0).toFixed(2)}%</span>
                <span>Funding: {((item.fundingRate ?? 0) * 100).toFixed(4)}%</span>
                <span>市值排名: #{item.marketCapRank ?? '-'}</span>
                <span>赛道: {item.sector}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <JournalPanel entries={journal} onAdd={(entry) => setJournal([entry, ...journal])} />
        </section>
      </details>
      </section>
    </div>
  )
}
