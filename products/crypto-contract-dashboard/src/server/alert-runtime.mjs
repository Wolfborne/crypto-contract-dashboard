function parseEntryRange(value) {
  const matches = value.match(/-?\d+(?:\.\d+)?/g) ?? []
  const nums = matches.map(Number).filter((n) => Number.isFinite(n))
  if (!nums.length) return { low: null, high: null }
  if (nums.length === 1) return { low: nums[0], high: nums[0] }
  return { low: Math.min(nums[0], nums[1]), high: Math.max(nums[0], nums[1]) }
}

function chineseExecutionStatus(status) {
  if (status === 'ALLOW_FULL') return '完全放行'
  if (status === 'ALLOW_CAPPED') return '放行但已压缩'
  if (status === 'RISK_OFF') return '风险收缩'
  if (status === 'RISK_OFF_CAPPED') return '风险收缩且已压缩'
  if (status === 'BLOCKED_BUDGET') return '预算拦截'
  return '风控拦截'
}

function periodsForSignal(signal) {
  if (signal.strategy === '轮动跟随') return { decision: '15m', structure: '1h' }
  if (signal.strategy === '趋势做空') return { decision: '15m', structure: '4h' }
  if (signal.strategy === '均值回归') return { decision: '15m', structure: '1h' }
  return { decision: '5m', structure: '1h' }
}

function pctOfEquity(value, accountEquity) {
  if (!Number.isFinite(value) || !Number.isFinite(accountEquity) || !accountEquity) return null
  return (value / accountEquity) * 100
}

function formatPct(value) {
  return value == null ? '-' : `${value.toFixed(2)}%`
}

function positionLevelLabel(liveStatus) {
  return liveStatus === 'LIVE_OK' ? '标准仓' : liveStatus === 'LIVE_SMALL' ? '试单仓' : '观察仓'
}

function directionLabelForSignal(signal) {
  return signal.strategy === '趋势做空' ? '做空 / SHORT' : '做多 / LONG'
}

function executionHeadlineForLiveStatus(status) {
  if (status === 'LIVE_OK') return '🟢 可下注'
  if (status === 'LIVE_SMALL') return '🟡 小仓试单'
  if (status === 'NO_TRADE') return '🔴 暂停'
  return '⚪ 继续观察'
}

function suggestedLeverage(liveStatus, configuredLeverage = 3) {
  const base = Number.isFinite(configuredLeverage) && configuredLeverage > 0 ? configuredLeverage : 3
  if (liveStatus === 'LIVE_SMALL') return Math.min(base, 3)
  if (liveStatus === 'LIVE_OK') return base
  return Math.min(base, 2)
}

function buildAlertBodyZh(signal, preview, live, sizing, accountEquity = 10000, configuredLeverage = 3) {
  const entry = parseEntryRange(signal.entry)
  const action = live.status === 'LIVE_OK'
    ? '可人工复核后下注'
    : live.status === 'LIVE_SMALL'
      ? '仅建议小仓试单'
      : live.status === 'NO_TRADE'
        ? '暂停下注'
        : '仅做观察'
  const periods = periodsForSignal(signal)
  const leverage = suggestedLeverage(live.status, configuredLeverage)
  const riskUsd = Number(sizing?.riskUsd ?? 0)
  const notionalUsd = Number(sizing?.notionalUsd ?? 0)
  const riskPct = pctOfEquity(riskUsd, accountEquity)
  const notionalPct = pctOfEquity(notionalUsd, accountEquity)
  const sizeRule = live.status === 'LIVE_SMALL'
    ? '试单仓 = 标准仓的 50%'
    : live.status === 'LIVE_OK'
      ? '标准仓 = 当前允许满额风险仓'
      : '仅观察，不建议实盘下单'
  return [
    executionHeadlineForLiveStatus(live.status),
    signal.symbol,
    directionLabelForSignal(signal),
    '',
    `入场：${entry.low ? `${entry.low.toFixed(2)} - ${entry.high?.toFixed(2)}` : signal.entry}`,
    `止损 / 止盈一：${signal.stopLoss} / ${signal.takeProfit1}`,
    `风险 / 仓位：${sizing ? `$${riskUsd.toFixed(2)}（${formatPct(riskPct)}） / $${notionalUsd.toFixed(2)}（${formatPct(notionalPct)}）` : '- / -'}`,
    `Why now：${preview.whyNow}`,
    '',
    '—— 详细说明 ——',
    `结论：${action}`,
    `级别：${live.status}（${positionLevelLabel(live.status)}）`,
    `决策周期：${periods.decision}`,
    `结构周期：${periods.structure}`,
    `策略 / 环境：${signal.strategy} / ${signal.environment}`,
    `执行状态：${preview.executionStatus}（${chineseExecutionStatus(preview.executionStatus)}）`,
    `建议杠杆：${leverage}x`,
    `仓位级别说明：${sizeRule}`,
    `匹配原因：${preview.matchReason}`,
    `说明：${live.reason}`,
  ].join('\n')
}

export function emitAlertsFromSnapshot(payload) {
  const now = new Date().toISOString()
  const out = []
  const items = payload?.signals ?? []
  const accountEquity = Number(payload?.settings?.accountEquity ?? 10000)
  const configuredLeverage = Number(payload?.settings?.leverage ?? 3)
  for (const item of items.slice(0, 3)) {
    if (!item?.signal || !item?.preview || !item?.live) continue
    if (item.live.status !== 'LIVE_OK' && item.live.status !== 'LIVE_SMALL') continue
    out.push({
      id: crypto.randomUUID(),
      createdAt: now,
      kind: item.live.status,
      title: `[${item.live.status === 'LIVE_OK' ? '可下注' : '小仓试单'} / ${item.live.status}] ${item.signal.symbol}`,
      body: buildAlertBodyZh(item.signal, item.preview, item.live, item.sizing ?? null, accountEquity, configuredLeverage),
      signature: `${item.signal.symbol}:${item.live.status}:${item.preview.executionStatus}:${item.preview.matchReason}`,
      status: 'PENDING',
    })
  }

  const summary = payload?.paperGateSummary
  if (summary && (summary.riskMode === 'RISK_OFF' || summary.riskMode === 'HARD_STOP' || summary.todayPnl <= summary.dailyLossLimit || summary.weekPnl <= summary.weeklyLossLimit)) {
    const riskLabel = summary.riskMode === 'HARD_STOP'
      ? '进入 HARD_STOP（停止新增真钱单）'
      : summary.riskMode === 'RISK_OFF'
        ? '进入 RISK_OFF（风险收缩）'
        : summary.todayPnl <= summary.dailyLossLimit
          ? '触发日损失限制'
          : '触发周损失限制'
    const headline = summary.riskMode === 'HARD_STOP' ? '🔴 暂停新增风险' : '🟠 风险收缩'
    const actionLine = summary.riskMode === 'HARD_STOP' ? '立刻动作：不新增真钱单' : '立刻动作：只允许更克制的小仓'
    const detailActions = summary.riskMode === 'HARD_STOP'
      ? ['- 不新增真钱单', '- 已有仓位只做减风险和处理', '- 新机会仅观察，不执行']
      : ['- 仅允许更克制的小仓', '- 只接受最清晰的 setup', '- 若已有降级 / cooldown，不放大仓位']
    out.push({
      id: crypto.randomUUID(),
      createdAt: now,
      kind: 'RISK_ALERT',
      title: `[风险提醒] ${riskLabel}`,
      body: [
        headline,
        summary.riskMode,
        actionLine,
        '',
        `当日 / 限制：${Number(summary.todayPnl).toFixed(2)} / ${Number(summary.dailyLossLimit).toFixed(2)}`,
        `本周 / 限制：${Number(summary.weekPnl).toFixed(2)} / ${Number(summary.weeklyLossLimit).toFixed(2)}`,
        `当前回撤：${Number(summary.drawdown).toFixed(2)}`,
        '',
        '—— 详细说明 ——',
        `风险模式：${summary.riskMode}`,
        `结论：${summary.riskMode === 'HARD_STOP' ? '暂停新增风险' : '仅允许更克制的小仓'}`,
        `说明：${riskLabel}`,
        '操作建议：',
        ...detailActions,
      ].join('\n'),
      signature: `risk:${riskLabel}`,
      status: 'PENDING',
    })
  }

  return out
}
