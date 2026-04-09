import type { AlertEvent, BacktestResult, DashboardSettings, PaperTrade, ResearchReportArchiveItem, ResearchReportDiff, TradeJournalEntry } from '../types'

const SETTINGS_KEY = 'crypto-dashboard-settings-v2'
const JOURNAL_KEY = 'crypto-dashboard-journal-v2'
const REPORT_HISTORY_KEY = 'crypto-dashboard-report-history-v1'
const PAPER_TRADES_KEY = 'crypto-dashboard-paper-trades-v1'
const ALERT_EVENTS_KEY = 'crypto-dashboard-alert-events-v1'
const ALERT_DEDUPE_KEY = 'crypto-dashboard-alert-dedupe-v1'

export const defaultSettings: DashboardSettings = {
  oversoldThreshold: -8,
  trendThreshold: 4,
  extremeVolatilityThreshold: 7,
  perTradeRiskPct: 0.5,
  leverage: 3,
  accountEquity: 10000,
  sizingMode: 'PAPER_EQUITY',
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
}

export function loadSettings(): DashboardSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw)
    return {
      ...defaultSettings,
      ...parsed,
      readiness: {
        ...defaultSettings.readiness,
        ...(parsed?.readiness ?? {}),
      },
    }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: DashboardSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadJournal(): TradeJournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveJournal(entries: TradeJournalEntry[]) {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries))
}

export function loadPaperTrades(): PaperTrade[] {
  try {
    const raw = localStorage.getItem(PAPER_TRADES_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function savePaperTrades(entries: PaperTrade[]) {
  localStorage.setItem(PAPER_TRADES_KEY, JSON.stringify(entries.slice(0, 100)))
}

export function loadAlertEvents(): AlertEvent[] {
  try {
    const raw = localStorage.getItem(ALERT_EVENTS_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveAlertEvents(entries: AlertEvent[]) {
  localStorage.setItem(ALERT_EVENTS_KEY, JSON.stringify(entries.slice(0, 50)))
}

export function loadAlertDedupe(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ALERT_DEDUPE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function saveAlertDedupe(value: Record<string, string>) {
  localStorage.setItem(ALERT_DEDUPE_KEY, JSON.stringify(value))
}

export function loadReportHistory(): ResearchReportArchiveItem[] {
  try {
    const raw = localStorage.getItem(REPORT_HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveReportHistory(entries: ResearchReportArchiveItem[]) {
  localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(entries.slice(0, 20)))
}

export function archiveBacktestResult(result: BacktestResult, version = 'v7.7'): ResearchReportArchiveItem {
  return {
    id: `${Date.now()}`,
    createdAt: new Date().toISOString(),
    version,
    score: result.report.machineAssessment.score,
    verdict: result.report.machineAssessment.verdict,
    label: result.report.machineAssessment.label,
    totalR: result.summary.totalR,
    oosTotalR: result.walkForward.summary.totalR,
    fundingR: result.summary.fundingR,
    maxDrawdownR: result.summary.maxDrawdownR,
    bestParameterSet: result.report.bestParameterSet,
    summaryLine: result.report.machineAssessment.summaryLine,
    note: '',
    milestone: false,
    confidence: result.report.machineAssessment.confidence,
    keyConcern: result.report.machineAssessment.keyConcern,
    nextAction: result.report.machineAssessment.nextAction,
    verdictText: result.report.machineAssessment.verdictText
  }
}

export function updateReportHistoryItem(entries: ResearchReportArchiveItem[], id: string, patch: Partial<ResearchReportArchiveItem>) {
  return entries.map((item) => item.id === id ? { ...item, ...patch } : item)
}

export function buildReportDiff(current: BacktestResult | null, previous: ResearchReportArchiveItem | null): ResearchReportDiff | null {
  if (!current || !previous) return null
  const scoreDelta = current.report.machineAssessment.score - previous.score
  const totalRDelta = current.summary.totalR - previous.totalR
  const oosTotalRDelta = current.walkForward.summary.totalR - previous.oosTotalR
  const fundingRDelta = current.summary.fundingR - previous.fundingR
  const maxDrawdownDelta = current.summary.maxDrawdownR - previous.maxDrawdownR
  return {
    scoreDelta,
    totalRDelta,
    oosTotalRDelta,
    fundingRDelta,
    maxDrawdownDelta,
    changed: Boolean(scoreDelta || totalRDelta || oosTotalRDelta || fundingRDelta || maxDrawdownDelta)
  }
}
