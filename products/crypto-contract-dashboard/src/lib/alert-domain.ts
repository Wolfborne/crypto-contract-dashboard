import type {
  AlertEvent,
  DashboardSignal,
  ExecutionStatus,
  ExecutionStatusStat,
  LiveReadiness,
  PaperGatePreview,
  PaperGateSummary,
} from '../types'

export type SizingSnapshot = {
  riskUsd: number
  notionalUsd: number
} | null

export function parsePriceText(value: string) {
  const matched = value.match(/-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

export function parseEntryRange(value: string) {
  const matches = value.match(/-?\d+(?:\.\d+)?/g) ?? []
  const nums = matches.map(Number).filter((n) => Number.isFinite(n))
  if (!nums.length) return { low: null, high: null, mid: null }
  if (nums.length === 1) return { low: nums[0], high: nums[0], mid: nums[0] }
  const low = Math.min(nums[0], nums[1])
  const high = Math.max(nums[0], nums[1])
  return { low, high, mid: (low + high) / 2 }
}

export function chineseExecutionStatus(status: ExecutionStatus) {
  if (status === 'ALLOW_FULL') return '完全放行'
  if (status === 'ALLOW_CAPPED') return '放行但已压缩'
  if (status === 'RISK_OFF') return '风险收缩'
  if (status === 'RISK_OFF_CAPPED') return '风险收缩且已压缩'
  if (status === 'BLOCKED_BUDGET') return '预算拦截'
  return '风控拦截'
}

export function evaluateLiveReadiness(
  signal: DashboardSignal,
  preview: PaperGatePreview | undefined,
  paperGateSummary: PaperGateSummary,
  executionStats: ExecutionStatusStat[],
): { status: LiveReadiness; reason: string } {
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

export function buildAlertBodyZh(
  signal: DashboardSignal,
  preview: PaperGatePreview,
  live: { status: LiveReadiness; reason: string },
  sizing: SizingSnapshot,
) {
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
    `Why now：${preview.whyNow}`,
  ].join('\n')
}

export function buildOpportunityAlertEvent(params: {
  signal: DashboardSignal
  preview: PaperGatePreview
  live: { status: LiveReadiness; reason: string }
  sizing: SizingSnapshot
  now?: string
}): AlertEvent | null {
  const { signal, preview, live, sizing, now = new Date().toISOString() } = params
  if (live.status !== 'LIVE_OK' && live.status !== 'LIVE_SMALL') return null
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    kind: live.status,
    title: `[${live.status === 'LIVE_OK' ? '可下注' : '小仓试单'} / ${live.status}] ${signal.symbol}`,
    body: buildAlertBodyZh(signal, preview, live, sizing),
    signature: `${signal.symbol}:${live.status}:${preview.executionStatus}:${preview.matchReason}`,
    status: 'PENDING',
  }
}

export function buildRiskAlertEvent(params: {
  riskMode: PaperGateSummary['riskMode']
  todayPnl: number
  dailyLossLimit: number
  weekPnl: number
  weeklyLossLimit: number
  drawdown: number
  now?: string
}): AlertEvent | null {
  const { riskMode, todayPnl, dailyLossLimit, weekPnl, weeklyLossLimit, drawdown, now = new Date().toISOString() } = params
  if (!(riskMode === 'RISK_OFF' || riskMode === 'HARD_STOP' || todayPnl <= dailyLossLimit || weekPnl <= weeklyLossLimit)) return null
  const riskLabel = riskMode === 'HARD_STOP'
    ? '进入 HARD_STOP（停止新增真钱单）'
    : riskMode === 'RISK_OFF'
      ? '进入 RISK_OFF（风险收缩）'
      : todayPnl <= dailyLossLimit
        ? '触发日损失限制'
        : '触发周损失限制'

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    kind: 'RISK_ALERT',
    title: `[风险提醒] ${riskLabel}`,
    body: [
      `风险模式：${riskMode}`,
      `当日损益：${todayPnl.toFixed(2)} / 限制 ${dailyLossLimit.toFixed(2)}`,
      `本周损益：${weekPnl.toFixed(2)} / 限制 ${weeklyLossLimit.toFixed(2)}`,
      `当前回撤：${drawdown.toFixed(2)}`,
    ].join('\n'),
    signature: `risk:${riskLabel}`,
    status: 'PENDING',
  }
}
