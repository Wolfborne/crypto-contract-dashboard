function parsePriceText(value) {
  const matched = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

function parseEntryRange(value) {
  const matches = String(value ?? '').match(/-?\d+(?:\.\d+)?/g) ?? []
  const nums = matches.map(Number).filter((n) => Number.isFinite(n))
  if (!nums.length) return { low: null, high: null, mid: null }
  if (nums.length === 1) return { low: nums[0], high: nums[0], mid: nums[0] }
  const low = Math.min(nums[0], nums[1])
  const high = Math.max(nums[0], nums[1])
  return { low, high, mid: (low + high) / 2 }
}

function getDayKey(value) {
  return new Date(value ?? Date.now()).toISOString().slice(0, 10)
}

function getWeekKey(value) {
  const d = new Date(value ?? Date.now())
  const day = d.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diffToMonday)
  return d.toISOString().slice(0, 10)
}

function riskProfileForEnvironment(environment) {
  if (environment === '趋势/牛市') return { maxOpenPositions: 4, maxSideExposure: 1.8, maxStrategyExposure: 1.1, maxSectorSideExposure: 1.1, maxBetaBucketSideExposure: 1.3, drawdownRiskOffTrigger: 3.5, drawdownHardStopTrigger: 5.5, dailyLossLimit: -250, weeklyLossLimit: -500 }
  if (environment === '弱势/空头') return { maxOpenPositions: 4, maxSideExposure: 1.7, maxStrategyExposure: 1.0, maxSectorSideExposure: 1.0, maxBetaBucketSideExposure: 1.2, drawdownRiskOffTrigger: 300, drawdownHardStopTrigger: 500, dailyLossLimit: -220, weeklyLossLimit: -450 }
  if (environment === '恐慌/超卖') return { maxOpenPositions: 2, maxSideExposure: 1.0, maxStrategyExposure: 0.8, maxSectorSideExposure: 0.7, maxBetaBucketSideExposure: 0.8, drawdownRiskOffTrigger: 200, drawdownHardStopTrigger: 350, dailyLossLimit: -150, weeklyLossLimit: -300 }
  return { maxOpenPositions: 3, maxSideExposure: 1.2, maxStrategyExposure: 0.9, maxSectorSideExposure: 0.8, maxBetaBucketSideExposure: 1.0, drawdownRiskOffTrigger: 250, drawdownHardStopTrigger: 400, dailyLossLimit: -180, weeklyLossLimit: -350 }
}

function environmentPriorityMultiplier(environment) {
  if (environment === '趋势/牛市') return 1.05
  if (environment === '恐慌/超卖') return 1
  if (environment === '弱势/空头') return 0.98
  if (environment === '震荡') return 0.9
  return 0.75
}

function executionStatusLabel(status) {
  return status
}

function executionMatchReason(status, cappedBy = 'none') {
  if (status === 'ALLOW_FULL') return 'gate pass + no cap'
  if (status === 'ALLOW_CAPPED') return `gate pass + ${cappedBy}`
  if (status === 'RISK_OFF') return 'risk-off + uncapped'
  if (status === 'RISK_OFF_CAPPED') return `risk-off + ${cappedBy}`
  if (status === 'BLOCKED_BUDGET') return 'blocked by risk budget'
  return 'blocked by gate'
}

function betaBucketForSymbol(symbol) {
  if (['BTC', 'ETH', 'SOL', 'AVAX', 'BNB'].includes(symbol)) return 'HIGH_BETA_MAJOR'
  if (['DOGE', 'XRP'].includes(symbol)) return 'HIGH_BETA_ALT'
  return 'NORMAL'
}

function sectorForSymbol(symbol) {
  if (symbol === 'BTC') return 'Store of Value'
  if (symbol === 'ETH' || symbol === 'SOL' || symbol === 'AVAX') return 'Layer 1'
  if (symbol === 'BNB') return 'Exchange'
  if (symbol === 'XRP') return 'Payments'
  if (symbol === 'DOGE') return 'Meme'
  if (symbol === 'LINK') return 'Oracle'
  return 'Other'
}

function buildPaperGateSummary(trades, activeRegime) {
  const openTrades = trades.filter((trade) => trade.status === 'OPEN')
  const closedTrades = trades.filter((trade) => trade.status === 'CLOSED')
  const profile = riskProfileForEnvironment(activeRegime ?? '震荡')
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
  const currentConcurrentRiskUsd = openTrades.reduce((sum, trade) => {
    const stop = parsePriceText(trade.stopLoss)
    if (!trade.entryPrice || !trade.quantity || !stop) return sum
    return sum + Math.abs(trade.entryPrice - stop) * trade.quantity
  }, 0)
  const longExposure = openTrades.filter((trade) => trade.side === 'LONG').reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const shortExposure = openTrades.filter((trade) => trade.side === 'SHORT').reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)
  const strategyExposure = Object.fromEntries([...new Set(openTrades.map((trade) => trade.strategy))].map((strategy) => [strategy, openTrades.filter((trade) => trade.strategy === strategy).reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)]))
  const sectorSideExposure = Object.fromEntries([...new Set(openTrades.map((trade) => `${sectorForSymbol(trade.symbol)}-${trade.side}`))].map((key) => [key, openTrades.filter((trade) => `${sectorForSymbol(trade.symbol)}-${trade.side}` === key).reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)]))
  const betaBucketExposure = Object.fromEntries([...new Set(openTrades.map((trade) => `${betaBucketForSymbol(trade.symbol)}-${trade.side}`))].map((key) => [key, openTrades.filter((trade) => `${betaBucketForSymbol(trade.symbol)}-${trade.side}` === key).reduce((sum, trade) => sum + (trade.notionalUsd ?? 0) / 1000, 0)]))
  return {
    regime: activeRegime ?? '未激活',
    riskMode: drawdown >= profile.drawdownHardStopTrigger ? 'HARD_STOP' : drawdown >= profile.drawdownRiskOffTrigger ? 'RISK_OFF' : 'NORMAL',
    currentEquity,
    peakEquity,
    drawdown,
    todayPnl,
    weekPnl,
    dailyLossLimit: profile.dailyLossLimit,
    weeklyLossLimit: profile.weeklyLossLimit,
    maxOpenPositions: profile.maxOpenPositions,
    currentConcurrentRiskUsd,
    openPositions: openTrades.length,
    longExposure,
    shortExposure,
    strategyExposure,
    sectorSideExposure,
    betaBucketExposure,
    profile,
  }
}

function evaluateGate(signal, settings, paperGateSummary) {
  const side = signal.strategy === '趋势做空' ? 'SHORT' : 'LONG'
  const profile = paperGateSummary.profile
  const baseSize = signal.environment === '趋势/牛市' ? 1 : signal.environment === '恐慌/超卖' ? 0.85 : signal.environment === '弱势/空头' ? 0.7 : 0.6
  const riskMode = signal.environment === '极端事件候选' || paperGateSummary.riskMode !== 'NORMAL' ? 'RISK_OFF' : 'NORMAL'
  const sideExposure = side === 'LONG' ? paperGateSummary.longExposure : paperGateSummary.shortExposure
  const strategyExposure = paperGateSummary.strategyExposure[signal.strategy] ?? 0
  const sectorKey = `${sectorForSymbol(signal.symbol)}-${side}`
  const sectorSideExposure = paperGateSummary.sectorSideExposure[sectorKey] ?? 0
  const betaKey = `${betaBucketForSymbol(signal.symbol)}-${side}`
  const betaBucketExposure = paperGateSummary.betaBucketExposure[betaKey] ?? 0
  let allowed = signal.environment !== '极端事件候选' && paperGateSummary.todayPnl > paperGateSummary.dailyLossLimit && paperGateSummary.weekPnl > paperGateSummary.weeklyLossLimit && paperGateSummary.riskMode !== 'HARD_STOP'
  let reason = allowed ? undefined : 'paper gate summary 拦截当前真钱准入'
  const size = riskMode === 'RISK_OFF' ? baseSize * 0.5 : baseSize
  if (allowed && paperGateSummary.openPositions >= paperGateSummary.maxOpenPositions) {
    allowed = false; reason = 'max open positions 超限'
  } else if (allowed && sideExposure + size > profile.maxSideExposure) {
    allowed = false; reason = 'side exposure 超限'
  } else if (allowed && strategyExposure + size > profile.maxStrategyExposure) {
    allowed = false; reason = 'strategy exposure 超限'
  } else if (allowed && sectorSideExposure + size > profile.maxSectorSideExposure) {
    allowed = false; reason = 'sector-side exposure 超限'
  } else if (allowed && betaBucketExposure + size > profile.maxBetaBucketSideExposure) {
    allowed = false; reason = 'beta bucket exposure 超限'
  }
  return {
    allowed,
    side,
    size,
    notionalUsd: 1000 * size,
    riskMode,
    drawdown: paperGateSummary.drawdown,
    todayPnl: paperGateSummary.todayPnl,
    weekPnl: paperGateSummary.weekPnl,
    reason,
  }
}

function calcSizing(signal, settings, gate, paperGateSummary) {
  const entry = parseEntryRange(signal.entry).mid
  const stop = parsePriceText(signal.stopLoss)
  if (!entry || !stop) return null
  const baseRiskUsd = settings.accountEquity * (settings.perTradeRiskPct / 100)
  const preCapRiskUsd = baseRiskUsd * (gate.allowed ? gate.size ?? 1 : 0)
  const softCappedRiskUsd = Math.min(preCapRiskUsd, settings.riskSoftCapUsd)
  const hardCappedRiskUsd = Math.min(softCappedRiskUsd, settings.riskHardCapUsd)
  const remainingConcurrentRiskUsd = Math.max(0, (settings.maxConcurrentRiskUsd ?? 250) - (paperGateSummary.currentConcurrentRiskUsd ?? 0))
  const riskUsd = Math.min(hardCappedRiskUsd, remainingConcurrentRiskUsd)
  const riskPerUnit = Math.abs(entry - stop)
  if (!riskPerUnit) return null
  const quantity = riskUsd / riskPerUnit
  const rawNotionalUsd = quantity * entry * settings.leverage
  const notionalUsd = gate.allowed ? Math.min(rawNotionalUsd, gate.notionalUsd ?? rawNotionalUsd) : 0
  const cappedBy = riskUsd < preCapRiskUsd
    ? `${softCappedRiskUsd < preCapRiskUsd ? `soft cap ${softCappedRiskUsd.toFixed(2)}` : ''}${hardCappedRiskUsd < softCappedRiskUsd ? `${softCappedRiskUsd < preCapRiskUsd ? ' + ' : ''}hard cap ${hardCappedRiskUsd.toFixed(2)}` : ''}${riskUsd < hardCappedRiskUsd ? `${(softCappedRiskUsd < preCapRiskUsd || hardCappedRiskUsd < softCappedRiskUsd) ? ' + ' : ''}concurrent risk budget ${remainingConcurrentRiskUsd.toFixed(2)}` : ''}`
    : 'none'
  return { riskUsd, notionalUsd, quantity, cappedBy, preCapRiskUsd }
}

function getExecutionStatus(gate, sizing) {
  if (!gate.allowed) return 'BLOCKED_GATE'
  if ((sizing?.riskUsd ?? 0) <= 0) return 'BLOCKED_BUDGET'
  if (gate.riskMode === 'RISK_OFF') return sizing && sizing.cappedBy !== 'none' ? 'RISK_OFF_CAPPED' : 'RISK_OFF'
  return sizing && sizing.cappedBy !== 'none' ? 'ALLOW_CAPPED' : 'ALLOW_FULL'
}

function evaluateLiveReadiness(signal, preview) {
  if (!preview) return { status: 'NO_TRADE', reason: '暂无 execution preview' }
  if (preview.executionStatus === 'ALLOW_FULL' && preview.matchReason === 'gate pass + no cap' && ['趋势/牛市', '恐慌/超卖'].includes(signal.environment) && ['轮动跟随', '均值回归'].includes(signal.strategy)) {
    return { status: 'LIVE_OK', reason: '完全放行 + 白名单环境策略' }
  }
  if (preview.executionStatus === 'ALLOW_CAPPED' && preview.matchReason.includes('soft cap') && ['趋势/牛市', '恐慌/超卖'].includes(signal.environment) && ['轮动跟随', '均值回归'].includes(signal.strategy)) {
    return { status: 'LIVE_SMALL', reason: 'soft cap 压缩，小仓试单' }
  }
  if (preview.executionStatus.startsWith('BLOCKED')) return { status: 'NO_TRADE', reason: '被 gate / 预算拦截' }
  return { status: 'PAPER_ONLY', reason: '继续观察' }
}

export function buildServerExecutionLayer(signals, settings, paperTrades = []) {
  const signalGatePreviews = {}
  const signalSizingSuggestions = {}
  const signalLiveReadiness = {}
  const paperGateSummary = buildPaperGateSummary(paperTrades, signals[0]?.environment)

  for (const signal of signals) {
    const gate = evaluateGate(signal, settings, paperGateSummary)
    const sizing = calcSizing(signal, settings, gate, paperGateSummary)
    const executionStatus = getExecutionStatus(gate, sizing)
    const matchReason = executionMatchReason(executionStatus, sizing?.cappedBy ?? 'none')
    const priorityScore = Number(((executionStatus === 'ALLOW_FULL' ? 100 : executionStatus === 'ALLOW_CAPPED' ? 85 : executionStatus === 'RISK_OFF' ? 70 : executionStatus === 'RISK_OFF_CAPPED' ? 55 : 20) + signal.score * environmentPriorityMultiplier(signal.environment) * ((gate.size ?? 0) || 0.2)).toFixed(2))
    const preview = {
      verdict: gate.allowed ? (gate.riskMode === 'RISK_OFF' ? 'RISK_OFF' : 'ALLOW') : 'BLOCKED',
      executionStatus,
      label: `${executionStatusLabel(executionStatus)} x${(gate.size ?? 0).toFixed(2)}`,
      detail: `prio=${priorityScore} | size=${(gate.size ?? 0).toFixed(2)} notional=${(gate.notionalUsd ?? 0).toFixed(0)}`,
      priorityScore,
      whyNow: gate.allowed ? `server-side gate 允许，环境=${signal.environment}，策略=${signal.strategy}` : `server-side gate 拦截：${gate.reason ?? '未知原因'}`,
      matchReason,
    }
    const live = evaluateLiveReadiness(signal, preview)
    preview.liveReadiness = live.status
    preview.liveReason = live.reason
    signalGatePreviews[signal.symbol] = preview
    signalSizingSuggestions[signal.symbol] = sizing
    signalLiveReadiness[signal.symbol] = live
  }

  return { paperGateSummary, signalGatePreviews, signalSizingSuggestions, signalLiveReadiness }
}
