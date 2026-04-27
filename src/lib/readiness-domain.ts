import type {
  DashboardSignal,
  ExecutionStatusStat,
  PaperGatePreview,
  PaperGateSummary,
  ReadinessCheck,
  ReadinessDecision,
  ReadinessEvaluation,
  ReadinessForcedMaxDecision,
  ReadinessRuntimeStateItem,
  ReadinessSettings,
  ValidationStats,
} from '../types'

function parsePriceText(value: string) {
  const matched = value.match(/-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

function parseEntryRange(value: string) {
  const matches = value.match(/-?\d+(?:\.\d+)?/g) ?? []
  const nums = matches.map(Number).filter((n) => Number.isFinite(n))
  if (!nums.length) return { low: null, high: null, mid: null }
  if (nums.length === 1) return { low: nums[0], high: nums[0], mid: nums[0] }
  const low = Math.min(nums[0], nums[1])
  const high = Math.max(nums[0], nums[1])
  return { low, high, mid: (low + high) / 2 }
}

function buildCheck(key: string, passed: boolean, message: string): ReadinessCheck {
  return { key, passed, message }
}

function estimateRiskReward(signal: DashboardSignal) {
  const entry = parseEntryRange(signal.entry).mid
  const stop = parsePriceText(signal.stopLoss)
  const tp1 = parsePriceText(signal.takeProfit1)
  if (!entry || !stop || !tp1) return null
  const risk = Math.abs(entry - stop)
  const reward = Math.abs(tp1 - entry)
  if (!risk) return null
  return reward / risk
}

function hasClearSetup(signal: DashboardSignal) {
  const entry = parseEntryRange(signal.entry).mid
  const stop = parsePriceText(signal.stopLoss)
  const tp1 = parsePriceText(signal.takeProfit1)
  return Boolean(entry && stop && tp1)
}

function getExecutionStat(preview: PaperGatePreview | undefined, executionStats: ExecutionStatusStat[]) {
  if (!preview?.executionStatus) return undefined
  return executionStats.find((item) => item.status === preview.executionStatus)
}

function decisionRank(decision: ReadinessDecision | ReadinessForcedMaxDecision) {
  if (decision === 'NO_TRADE') return 0
  if (decision === 'PAPER_ONLY') return 1
  if (decision === 'LIVE_SMALL') return 2
  if (decision === 'LIVE_OK') return 3
  return 99
}

function clampDecision(baseDecision: ReadinessDecision, forcedMaxDecision: Exclude<ReadinessForcedMaxDecision, null>) {
  return decisionRank(baseDecision) <= decisionRank(forcedMaxDecision) ? baseDecision : forcedMaxDecision
}

export function buildReadinessSetupKey(signal: DashboardSignal, preview?: PaperGatePreview) {
  return `${signal.strategy}|${signal.environment}|${preview?.executionStatus ?? 'UNKNOWN'}`
}

export function evaluateReadiness(params: {
  signal: DashboardSignal
  preview?: PaperGatePreview
  paperGateSummary: PaperGateSummary
  executionStats: ExecutionStatusStat[]
  readiness: ReadinessSettings
}): ReadinessEvaluation {
  const { signal, preview, paperGateSummary, executionStats, readiness } = params

  if (!readiness.enabled) {
    return {
      finalDecision: 'PAPER_ONLY',
      hardBlockReasons: [],
      softBlockReasons: ['readiness engine disabled'],
      trialReadyChecks: [],
      fullReadyChecks: [],
    }
  }

  const hardBlockReasons: string[] = []
  if (paperGateSummary.riskMode === 'HARD_STOP') hardBlockReasons.push('riskMode = HARD_STOP')
  if (paperGateSummary.todayPnl <= paperGateSummary.dailyLossLimit) hardBlockReasons.push('触发日损失熔断')
  if (paperGateSummary.weekPnl <= paperGateSummary.weeklyLossLimit) hardBlockReasons.push('触发周损失熔断')
  if (preview?.executionStatus === 'BLOCKED_GATE') hardBlockReasons.push('execution 被 gate 拦截')
  if (preview?.executionStatus === 'BLOCKED_BUDGET') hardBlockReasons.push('execution 被预算拦截')

  if (hardBlockReasons.length) {
    return {
      finalDecision: 'NO_TRADE',
      hardBlockReasons,
      softBlockReasons: [],
      trialReadyChecks: [],
      fullReadyChecks: [],
    }
  }

  const softBlockReasons: string[] = []
  if (!preview) softBlockReasons.push('缺少 execution preview')
  const stat = getExecutionStat(preview, executionStats)
  const sample = stat?.closed ?? 0
  const rr = estimateRiskReward(signal)

  if (!readiness.liveSmallEnvironments.includes(signal.environment)) softBlockReasons.push(`环境不在试单白名单：${signal.environment}`)
  if (!readiness.liveSmallStrategies.includes(signal.strategy)) softBlockReasons.push(`策略不在试单白名单：${signal.strategy}`)
  if (sample < readiness.minSampleForLiveSmall) softBlockReasons.push(`样本不足：${sample} < ${readiness.minSampleForLiveSmall}`)
  if (!hasClearSetup(signal)) softBlockReasons.push('setup 不完整：entry/stop/tp 不清晰')
  if (rr == null || rr < readiness.minRRForLiveSmall) softBlockReasons.push(`RR 不达标：${rr == null ? 'N/A' : rr.toFixed(2)} < ${readiness.minRRForLiveSmall}`)

  if (softBlockReasons.length) {
    return {
      finalDecision: 'PAPER_ONLY',
      hardBlockReasons: [],
      softBlockReasons,
      trialReadyChecks: [],
      fullReadyChecks: [],
    }
  }

  const trialReadyChecks: ReadinessCheck[] = [
    buildCheck('risk-mode-normal', paperGateSummary.riskMode === 'NORMAL', `riskMode = ${paperGateSummary.riskMode}`),
    buildCheck('execution-allowed-for-trial', Boolean(preview?.executionStatus && readiness.liveSmallAllowedExecution.includes(preview.executionStatus)), `executionStatus = ${preview?.executionStatus ?? 'N/A'}`),
    buildCheck('environment-allowed-for-trial', readiness.liveSmallEnvironments.includes(signal.environment), `environment = ${signal.environment}`),
    buildCheck('strategy-allowed-for-trial', readiness.liveSmallStrategies.includes(signal.strategy), `strategy = ${signal.strategy}`),
    buildCheck('clear-setup', hasClearSetup(signal), 'entry / stop / tp1 可解析'),
    buildCheck('rr-for-trial', rr != null && rr >= readiness.minRRForLiveSmall, `RR = ${rr == null ? 'N/A' : rr.toFixed(2)}`),
  ]
  const trialReady = trialReadyChecks.every((item) => item.passed)

  const fullReadyChecks: ReadinessCheck[] = [
    buildCheck('execution-allowed-for-live', Boolean(preview?.executionStatus && readiness.liveOkAllowedExecution.includes(preview.executionStatus)), `executionStatus = ${preview?.executionStatus ?? 'N/A'}`),
    buildCheck('sample-for-live', sample >= readiness.minSampleForLiveOk, `sample = ${sample}`),
    buildCheck('winrate-for-live', (stat?.winRate ?? 0) >= readiness.minWinRateForLiveOk, `winRate = ${(stat?.winRate ?? 0).toFixed(2)}`),
    buildCheck('pnl-positive-for-live', (stat?.realizedPnl ?? 0) > 0, `realizedPnl = ${(stat?.realizedPnl ?? 0).toFixed(2)}`),
    buildCheck('environment-allowed-for-live', readiness.liveOkEnvironments.includes(signal.environment), `environment = ${signal.environment}`),
    buildCheck('strategy-allowed-for-live', readiness.liveOkStrategies.includes(signal.strategy), `strategy = ${signal.strategy}`),
    buildCheck('rr-for-live', rr != null && rr >= readiness.minRRForLiveOk, `RR = ${rr == null ? 'N/A' : rr.toFixed(2)}`),
  ]
  const fullReady = fullReadyChecks.every((item) => item.passed)

  if (fullReady) {
    return { finalDecision: 'LIVE_OK', hardBlockReasons: [], softBlockReasons: [], trialReadyChecks, fullReadyChecks }
  }
  if (trialReady) {
    return { finalDecision: 'LIVE_SMALL', hardBlockReasons: [], softBlockReasons: [], trialReadyChecks, fullReadyChecks }
  }
  return {
    finalDecision: 'PAPER_ONLY',
    hardBlockReasons: [],
    softBlockReasons: ['未通过 trial-ready 最低条件'],
    trialReadyChecks,
    fullReadyChecks,
  }
}

function applyValidationGating(evaluation: ReadinessEvaluation, readiness: ReadinessSettings, validationStats?: ValidationStats | null): ReadinessEvaluation {
  if (!validationStats) {
    return {
      ...evaluation,
      validationStats: null,
      validationReasons: ['缺少 setup validation stats'],
      finalDecision: evaluation.finalDecision === 'LIVE_OK' ? 'LIVE_SMALL' : evaluation.finalDecision,
    }
  }

  const softBlockReasons = [...evaluation.softBlockReasons]
  const validationReasons: string[] = []
  let finalDecision = evaluation.finalDecision

  if (validationStats.sampleCount < readiness.minSampleForLiveSmall) {
    validationReasons.unshift(`validation 样本不足：${validationStats.sampleCount} < ${readiness.minSampleForLiveSmall}`)
    finalDecision = 'PAPER_ONLY'
  }

  if (finalDecision === 'LIVE_OK') {
    if (validationStats.sampleCount < readiness.minSampleForLiveOk) {
      validationReasons.unshift(`LIVE_OK 样本不足：${validationStats.sampleCount} < ${readiness.minSampleForLiveOk}`)
      finalDecision = 'LIVE_SMALL'
    }
    if (validationStats.winRate < readiness.minWinRateForLiveOk) {
      validationReasons.unshift(`LIVE_OK 胜率不足：${validationStats.winRate.toFixed(2)} < ${readiness.minWinRateForLiveOk}`)
      finalDecision = 'LIVE_SMALL'
    }
    if (validationStats.avgResultR < readiness.minAvgRForLiveOk) {
      validationReasons.unshift(`LIVE_OK 平均 R 不足：${validationStats.avgResultR.toFixed(2)} < ${readiness.minAvgRForLiveOk}`)
      finalDecision = 'LIVE_SMALL'
    }
    if (validationStats.drawdownR > readiness.maxValidationDrawdownForLiveOk) {
      validationReasons.unshift(`LIVE_OK drawdownR 过大：${validationStats.drawdownR.toFixed(2)}`)
      finalDecision = 'PAPER_ONLY'
    }
  }

  return { ...evaluation, finalDecision, softBlockReasons, validationReasons, validationStats }
}

export function applyReadinessDowngrade(evaluation: ReadinessEvaluation, runtimeItem?: ReadinessRuntimeStateItem | null): ReadinessEvaluation {
  const baseDecision = evaluation.finalDecision
  if (!runtimeItem || !runtimeItem.forcedMaxDecision) {
    return {
      ...evaluation,
      baseDecision,
      effectiveDecision: baseDecision,
      setupKey: runtimeItem?.setupKey ?? evaluation.setupKey,
      forcedMaxDecision: runtimeItem?.forcedMaxDecision ?? null,
      cooldownRemainingTrades: runtimeItem?.cooldownRemainingTrades ?? 0,
      degradeReason: runtimeItem?.lastDegradeReason ?? null,
    }
  }

  const effectiveDecision = clampDecision(baseDecision, runtimeItem.forcedMaxDecision)
  const degradeReason = runtimeItem.lastDegradeReason ?? `当前 setup 处于 cooldown，最多只允许 ${runtimeItem.forcedMaxDecision}`
  return {
    ...evaluation,
    finalDecision: effectiveDecision,
    softBlockReasons: effectiveDecision !== baseDecision ? [degradeReason, ...evaluation.softBlockReasons] : evaluation.softBlockReasons,
    baseDecision,
    effectiveDecision,
    forcedMaxDecision: runtimeItem.forcedMaxDecision,
    cooldownRemainingTrades: runtimeItem.cooldownRemainingTrades,
    degradeReason,
  }
}

export function evaluateReadinessWithValidationAndRuntime(params: {
  signal: DashboardSignal
  preview?: PaperGatePreview
  paperGateSummary: PaperGateSummary
  executionStats: ExecutionStatusStat[]
  readiness: ReadinessSettings
  validationStats?: ValidationStats | null
  runtimeItem?: ReadinessRuntimeStateItem | null
}): ReadinessEvaluation {
  const baseEvaluation = evaluateReadiness(params)
  const setupKey = buildReadinessSetupKey(params.signal, params.preview)
  const validated = applyValidationGating({ ...baseEvaluation, setupKey }, params.readiness, params.validationStats)
  return applyReadinessDowngrade(validated, params.runtimeItem)
}
