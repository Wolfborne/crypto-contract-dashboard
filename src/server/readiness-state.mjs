import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../../data-runtime')
const READINESS_STATE_FILE = path.join(DATA_DIR, 'readiness-state.json')

function ensureReadinessStateFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(READINESS_STATE_FILE)) {
    fs.writeFileSync(READINESS_STATE_FILE, JSON.stringify({ setups: {} }, null, 2), 'utf8')
  }
}

export function readReadinessState() {
  ensureReadinessStateFile()
  try {
    return JSON.parse(fs.readFileSync(READINESS_STATE_FILE, 'utf8'))
  } catch {
    return { setups: {} }
  }
}

export function writeReadinessState(state) {
  ensureReadinessStateFile()
  fs.writeFileSync(READINESS_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

export function getReadinessStateItem(setupKey) {
  const state = readReadinessState()
  return state.setups?.[setupKey] ?? null
}

export function upsertReadinessStateItem(setupKey, patch) {
  const state = readReadinessState()
  const current = state.setups?.[setupKey] ?? {
    setupKey,
    liveSmallLossStreak: 0,
    liveOkLossStreak: 0,
    forcedMaxDecision: null,
    cooldownRemainingTrades: 0,
    updatedAt: new Date().toISOString(),
  }
  state.setups[setupKey] = {
    ...current,
    ...patch,
    setupKey,
    updatedAt: new Date().toISOString(),
  }
  writeReadinessState(state)
  return state.setups[setupKey]
}

export function updateReadinessStateOnTradeClose({
  setupKey,
  readinessDecision,
  realizedPnl,
  cooldownAfterDegradeTrades,
  liveSmallLossStreakToPaperOnly,
  liveOkLossStreakToLiveSmall,
  liveOkLossStreakToPaperOnly,
}) {
  const state = readReadinessState()
  const current = state.setups?.[setupKey] ?? {
    setupKey,
    liveSmallLossStreak: 0,
    liveOkLossStreak: 0,
    forcedMaxDecision: null,
    cooldownRemainingTrades: 0,
    updatedAt: new Date().toISOString(),
  }

  const next = { ...current }
  if (next.cooldownRemainingTrades > 0) {
    next.cooldownRemainingTrades = Math.max(0, next.cooldownRemainingTrades - 1)
    if (next.cooldownRemainingTrades === 0 && next.forcedMaxDecision) {
      next.forcedMaxDecision = null
      next.lastDegradeReason = 'cooldown ended'
    }
  }

  const isLoss = realizedPnl < 0
  const isWin = realizedPnl > 0

  if (readinessDecision === 'LIVE_SMALL') {
    next.liveSmallLossStreak = isLoss ? next.liveSmallLossStreak + 1 : (isWin ? 0 : next.liveSmallLossStreak)
    if (next.liveSmallLossStreak >= liveSmallLossStreakToPaperOnly) {
      next.forcedMaxDecision = 'PAPER_ONLY'
      next.cooldownRemainingTrades = cooldownAfterDegradeTrades
      next.lastDegradeReason = 'LIVE_SMALL 连亏触发降级'
    }
  }

  if (readinessDecision === 'LIVE_OK') {
    next.liveOkLossStreak = isLoss ? next.liveOkLossStreak + 1 : (isWin ? 0 : next.liveOkLossStreak)
    if (next.liveOkLossStreak >= liveOkLossStreakToPaperOnly) {
      next.forcedMaxDecision = 'PAPER_ONLY'
      next.cooldownRemainingTrades = cooldownAfterDegradeTrades
      next.lastDegradeReason = 'LIVE_OK 连亏触发 PAPER_ONLY 降级'
    } else if (next.liveOkLossStreak >= liveOkLossStreakToLiveSmall) {
      next.forcedMaxDecision = 'LIVE_SMALL'
      next.cooldownRemainingTrades = cooldownAfterDegradeTrades
      next.lastDegradeReason = 'LIVE_OK 连亏触发 LIVE_SMALL 降级'
    }
  }

  state.setups[setupKey] = {
    ...next,
    updatedAt: new Date().toISOString(),
  }
  writeReadinessState(state)
  return { ok: true, item: state.setups[setupKey] }
}
