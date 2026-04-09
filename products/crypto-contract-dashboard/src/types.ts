export type SymbolConfig = {
  symbol: string
  label: string
  coingeckoId: string
  sector: string
}

export type MarketSnapshot = {
  symbol: string
  price: number
  change24h: number
  volume24h?: number
  fundingRate?: number
  openInterest?: number
  ma20DiffPct?: number
  ma30DiffPct?: number
  volatilityScore?: number
  marketCap?: number
  marketCapRank?: number
  sector?: string
}

export type EnvironmentType = '恐慌/超卖' | '趋势/牛市' | '震荡' | '极端事件候选' | '弱势/空头'
export type StrategyType = '均值回归' | '轮动跟随' | '错价修复候选' | '趋势做空'

export type DashboardSignal = {
  symbol: string
  strategy: StrategyType
  environment: EnvironmentType
  score: number
  entry: string
  stopLoss: string
  takeProfit1: string
  takeProfit2: string
  note: string
}

export type PaperTrade = {
  id: string
  createdAt: string
  symbol: string
  strategy: StrategyType
  environment: EnvironmentType
  side: 'LONG' | 'SHORT'
  signalScore: number
  entryPlan: string
  stopLoss: string
  takeProfit1: string
  takeProfit2: string
  note: string
  status: 'OPEN' | 'CLOSED' | 'BLOCKED'
  entryPrice?: number
  exitPrice?: number
  quantity?: number
  notionalUsd?: number
  currentPrice?: number
  unrealizedPnl?: number
  realizedPnl?: number
  realizedPnlPct?: number
  plannedRiskUsd?: number
  resultR?: number
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL' | 'BLOCKED'
  gateReason?: string
  executionStatus?: ExecutionStatus
  matchReason?: string
  readinessDecision?: ReadinessDecision
  readinessSetupKey?: string
  closedAt?: string
}

export type ExecutionStatusStat = {
  status: ExecutionStatus
  total: number
  open: number
  closed: number
  blocked: number
  winRate: number
  realizedPnl: number
}

export type MatchReasonStat = {
  reason: string
  total: number
  open: number
  closed: number
  blocked: number
  winRate: number
  realizedPnl: number
}

export type PaperEquityPoint = {
  index: number
  label: string
  equityUsd: number
}

export type ExecutionStatus = 'ALLOW_FULL' | 'ALLOW_CAPPED' | 'RISK_OFF' | 'RISK_OFF_CAPPED' | 'BLOCKED_GATE' | 'BLOCKED_BUDGET'
export type LiveReadiness = 'LIVE_OK' | 'LIVE_SMALL' | 'PAPER_ONLY' | 'NO_TRADE'

export type PaperGatePreview = {
  verdict: 'ALLOW' | 'BLOCKED' | 'RISK_OFF'
  executionStatus: ExecutionStatus
  label: string
  detail: string
  priorityScore: number
  whyNow: string
  matchReason: string
  liveReadiness?: LiveReadiness
  liveReason?: string
}

export type AlertEvent = {
  id: string
  createdAt: string
  kind: 'LIVE_OK' | 'LIVE_SMALL' | 'RISK_ALERT'
  title: string
  body: string
  signature: string
  severity?: 'HIGH' | 'MEDIUM' | 'LOW'
  status?: 'PENDING' | 'SENT' | 'ACKED' | 'FAILED'
  sentAt?: string
  ackedAt?: string
  retryCount?: number
  nextRetryAt?: string | null
  lastDeliveryError?: string | null
}

export type PaperGateSummary = {
  regime: EnvironmentType | '未激活'
  riskMode: 'NORMAL' | 'RISK_OFF' | 'HARD_STOP'
  openPositions: number
  maxOpenPositions: number
  currentEquity: number
  peakEquity: number
  drawdown: number
  drawdownRiskOffTrigger: number
  drawdownHardStopTrigger: number
  todayPnl: number
  dailyLossLimit: number
  weekPnl: number
  weeklyLossLimit: number
  exposures: {
    long: { used: number, limit: number }
    short: { used: number, limit: number }
    strategies: Array<{ key: string, used: number, limit: number }>
    sectors: Array<{ key: string, used: number, limit: number }>
    betaBuckets: Array<{ key: string, used: number, limit: number }>
  }
  lastDecision?: string
}

export type ReadinessDecision = 'NO_TRADE' | 'PAPER_ONLY' | 'LIVE_SMALL' | 'LIVE_OK'

export type ReadinessCheck = {
  key: string
  passed: boolean
  message: string
}

export type ReadinessSettings = {
  enabled: boolean
  liveSmallRiskMultiplier: number
  liveSmallLossStreakToPaperOnly: number
  liveOkLossStreakToLiveSmall: number
  liveOkLossStreakToPaperOnly: number
  cooldownAfterDegradeTrades: number
  minSampleForLiveSmall: number
  minSampleForLiveOk: number
  validationWindowTrades: number
  minWinRateForLiveSmall: number
  minWinRateForLiveOk: number
  minAvgRForLiveSmall: number
  minAvgRForLiveOk: number
  maxValidationDrawdownForLiveSmall: number
  maxValidationDrawdownForLiveOk: number
  liveSmallAllowedExecution: ExecutionStatus[]
  liveOkAllowedExecution: ExecutionStatus[]
  liveOkEnvironments: EnvironmentType[]
  liveSmallEnvironments: EnvironmentType[]
  liveOkStrategies: StrategyType[]
  liveSmallStrategies: StrategyType[]
  minRRForLiveSmall: number
  minRRForLiveOk: number
  maxDirectionalRiskR: number
  maxSectorRiskR: number
  maxBetaBucketRiskR: number
  maxOpenLivePositions: number
  maxSlippagePctForLiveSmall: number
  maxSlippagePctForLiveOk: number
}

export type ReadinessForcedMaxDecision = 'NO_TRADE' | 'PAPER_ONLY' | 'LIVE_SMALL' | null

export type ReadinessRuntimeStateItem = {
  setupKey: string
  liveSmallLossStreak: number
  liveOkLossStreak: number
  forcedMaxDecision: ReadinessForcedMaxDecision
  cooldownRemainingTrades: number
  lastDegradeReason?: string
  updatedAt: string
}

export type ReadinessRuntimeState = {
  setups: Record<string, ReadinessRuntimeStateItem>
}

export type ValidationStats = {
  setupKey: string
  sampleCount: number
  closedCount: number
  winCount: number
  lossCount: number
  winRate: number
  realizedPnl: number
  avgRealizedPnl: number
  avgRProxy: number
  avgResultR: number
  totalResultR: number
  lossStreak: number
  maxLossStreak: number
  drawdownProxy: number
  drawdownR: number
  lastUpdatedAt?: string
}

export type ValidationStatsMap = Record<string, ValidationStats>

export type ReadinessEvaluation = {
  finalDecision: ReadinessDecision
  hardBlockReasons: string[]
  softBlockReasons: string[]
  validationReasons?: string[]
  trialReadyChecks: ReadinessCheck[]
  fullReadyChecks: ReadinessCheck[]
  setupKey?: string
  baseDecision?: ReadinessDecision
  effectiveDecision?: ReadinessDecision
  forcedMaxDecision?: ReadinessForcedMaxDecision
  cooldownRemainingTrades?: number
  degradeReason?: string | null
  validationStats?: ValidationStats | null
}

export type DashboardSettings = {
  oversoldThreshold: number
  trendThreshold: number
  extremeVolatilityThreshold: number
  perTradeRiskPct: number
  leverage: number
  accountEquity: number
  sizingMode: 'FIXED_CAPITAL' | 'PAPER_EQUITY' | 'PAPER_FLOATING_EQUITY'
  riskSoftCapUsd: number
  riskHardCapUsd: number
  maxConcurrentRiskUsd: number
  traderTimeZone: string
  traderDayStartHour: number
  traderNightStartHour: number
  digestLiveOkDayWindowSec: number
  digestLiveOkNightWindowSec: number
  digestLiveSmallDayWindowSec: number
  digestLiveSmallNightWindowSec: number
  traderDayImmediateLiveOk: boolean
  traderNightImmediateLiveOk: boolean
  readiness: ReadinessSettings
}

export type SectorHeat = {
  sector: string
  avg24hChange: number
  count: number
}

export type TradeJournalEntry = {
  id: string
  createdAt: string
  symbol: string
  strategy: StrategyType
  environment: EnvironmentType
  side: 'LONG' | 'SHORT'
  thesis: string
  entryPrice: number
  stopPrice: number
  exitPrice: number
  resultR: number
  note?: string
}

export type BacktestRow = {
  symbol: string
  trades: number
  winRate: number
  avgR: number
  totalR: number
  priceOnlyR: number
  fundingR: number
  maxDrawdownR: number
}

export type EquityPoint = {
  index: number
  equityR: number
}

export type MonthlyStat = {
  month: string
  trades: number
  totalR: number
}

export type StrategyBreakdown = {
  strategy: '均值回归' | '轮动跟随' | '趋势做空'
  trades: number
  winRate: number
  avgR: number
  totalR: number
  priceOnlyR: number
  fundingR: number
  maxDrawdownR: number
}

export type ParameterScanRow = {
  oversoldThreshold: number
  trendThreshold: number
  holdBars: number
  trades: number
  winRate: number
  avgR: number
  totalR: number
  maxDrawdownR: number
  scoreProfitDrawdown: number
  scoreExpectancy: number
}

export type WalkForwardWindow = {
  windowIndex: number
  trainStart: string
  trainEnd: string
  testStart: string
  testEnd: string
  selectedBy: '收益/回撤' | '期望值'
  bestParams: {
    oversoldThreshold: number
    trendThreshold: number
    holdBars: number
  }
  trainTrades: number
  trainTotalR: number
  testTrades: number
  testWinRate: number
  testAvgR: number
  testPriceOnlyR: number
  testFundingR: number
  testTotalR: number
  testMaxDrawdownR: number
}

export type MachineAssessment = {
  score: number
  confidence: '低' | '中' | '高'
  label: '可继续研究' | '谨慎观察' | '暂不建议实盘' | '参数不稳定'
  verdict: 'GREEN' | 'YELLOW' | 'RED'
  verdictText: string
  summaryLine: string
  nextAction: string
  keyConcern: string
  tags: string[]
  rationale: string[]
}

export type ResearchReport = {
  title: string
  conclusion: string
  currentRecommendation: string
  strongestStrategy: string
  weakestStrategy: string
  bestParameterSet: string
  mostStableParameterSet: string
  walkForwardTakeaway: string
  fundingTakeaway: string
  riskNotes: string[]
  machineAssessment: MachineAssessment
}

export type BacktestResult = {
  bySymbol: BacktestRow[]
  byStrategy: StrategyBreakdown[]
  parameterScan: ParameterScanRow[]
  summary: {
    trades: number
    winRate: number
    avgR: number
    totalR: number
    priceOnlyR: number
    fundingR: number
    maxDrawdownR: number
    expectancy: number
  }
  equityCurve: EquityPoint[]
  monthly: MonthlyStat[]
  walkForward: {
    enabled: boolean
    trainBars: number
    testBars: number
    stepBars: number
    windows: WalkForwardWindow[]
    summary: {
      windows: number
      trades: number
      winRate: number
      avgR: number
      totalR: number
      priceOnlyR: number
      fundingR: number
      maxDrawdownR: number
    }
  }
  report: ResearchReport
  assumptions: {
    feePerSidePct: number
    slippagePerSidePct: number
    holdBars: number
    fundingIncluded: boolean
    partialTakeProfit: boolean
    dynamicTrailingStop: boolean
    timeExitEnabled: boolean
    invalidationExitEnabled: boolean
    strategyRiskBudgetEnabled: boolean
    lossStreakThrottleEnabled: boolean
    dailyLossLimitEnabled: boolean
    weeklyLossLimitEnabled: boolean
    regimeAwareRiskEnabled: boolean
    intrabarMode: 'conservative'
  }
}

export type ResearchReportArchiveItem = {
  id: string
  createdAt: string
  version: string
  score: number
  verdict: 'GREEN' | 'YELLOW' | 'RED'
  label: string
  totalR: number
  oosTotalR: number
  fundingR: number
  maxDrawdownR: number
  bestParameterSet: string
  summaryLine: string
  note?: string
  milestone?: boolean
  confidence?: '低' | '中' | '高'
  keyConcern?: string
  nextAction?: string
  verdictText?: string
}

export type ResearchReportDiff = {
  scoreDelta: number
  totalRDelta: number
  oosTotalRDelta: number
  fundingRDelta: number
  maxDrawdownDelta: number
  changed: boolean
}

export type DataSourceHealth = {
  ok: boolean
  degraded?: boolean
  reason?: string | null
  lastSuccessAt?: string | null
}

export type DashboardData = {
  snapshots: MarketSnapshot[]
  signals: DashboardSignal[]
  fearGreedValue: number
  environmentSummary: string
  sectorHeat: SectorHeat[]
  dataSourceStatus?: {
    coingecko?: DataSourceHealth
  }
}
