import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DEX_BASE = 'https://api.dexscreener.com'
const GOPLUS_BASE = 'https://api.gopluslabs.io'
const TRUSTED_QUOTES = new Set(['USDC', 'USDT', 'WETH', 'WBNB', 'SOL', 'WSOL'])
const BLOCKED_KEYWORDS = ['test', 'wrapped voucher', 'voucher', 'scam']
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../../data-runtime')
const MOONSHOT_HISTORY_FILE = path.join(DATA_DIR, 'moonshot-history.json')

const MOONSHOT_LIMITS = {
  cooldownMs: {
    EXTREME: 30 * 60 * 1000,
    HOT: 15 * 60 * 1000,
    WATCH: 10 * 60 * 1000,
  },
  keepCandidateScoreMin: 55,
  keepCandidateDowngradeScoreMin: 68,
  keepCandidateDowngradeRaveMin: 45,
  feedback: {
    minComboSamples: 2,
    tonePoolMinSamples: 3,
    broadFallbackMinSamples: 4,
    minConfidenceForAlert: 0.35,
    maxRankingAdjustment: 90,
    maxAlertAdjustment: 6,
    recentWindow: 3,
    reversalMinFails: 2,
    outcomeHalfLifeMs: 24 * 60 * 60 * 1000,
    trackOutcomeResolveMs: 4 * 60 * 60 * 1000,
    winThresholdPct: 8,
    failThresholdPct: -5,
  },
  history: {
    snapshotSeries: 12,
    inactiveSnapshotSeries: 6,
    regimeSnapshots: 36,
    leaderboardMinSamples: 2,
    trackedOutcomeMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    resolvedOutcomeKeep: 200,
    activeOutcomeKeep: 200,
  },
  alerts: {
    maxPerScan: 4,
    maxTransitionAlerts: 2,
    maxStageAlerts: 2,
  },
  runtime: {
    fetchTimeoutMs: 12000,
  },
}

fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(MOONSHOT_HISTORY_FILE)) fs.writeFileSync(MOONSHOT_HISTORY_FILE, JSON.stringify({ snapshots: {}, lastAlerts: {}, cooldowns: {}, regimeSnapshots: [], trackedOutcomes: {} }, null, 2), 'utf8')

function safeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MOONSHOT_LIMITS.runtime.fetchTimeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'crypto-contract-dashboard/0.1'
      },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Request failed: ${url} (${res.status})`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

function goplusChainId(chainId) {
  const value = String(chainId ?? '').toLowerCase()
  if (value === 'ethereum' || value === 'eth') return '1'
  if (value === 'bsc' || value === 'binance-smart-chain') return '56'
  if (value === 'base') return '8453'
  if (value === 'arbitrum') return '42161'
  if (value === 'polygon') return '137'
  if (value === 'avalanche') return '43114'
  if (value === 'tron') return 'tron'
  return null
}

function parseBooleanish(value) {
  return value === '1' || value === 1 || value === true || value === 'true'
}

function readHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MOONSHOT_HISTORY_FILE, 'utf8'))
    return {
      snapshots: parsed?.snapshots ?? {},
      lastAlerts: parsed?.lastAlerts ?? {},
      cooldowns: parsed?.cooldowns ?? {},
      regimeSnapshots: Array.isArray(parsed?.regimeSnapshots) ? parsed.regimeSnapshots : [],
      trackedOutcomes: parsed?.trackedOutcomes ?? {},
    }
  } catch {
    return { snapshots: {}, lastAlerts: {}, cooldowns: {}, regimeSnapshots: [], trackedOutcomes: {} }
  }
}

function pruneHistoryState(historyState, now = Date.now()) {
  const next = {
    snapshots: { ...(historyState?.snapshots ?? {}) },
    lastAlerts: { ...(historyState?.lastAlerts ?? {}) },
    cooldowns: { ...(historyState?.cooldowns ?? {}) },
    regimeSnapshots: Array.isArray(historyState?.regimeSnapshots) ? [...historyState.regimeSnapshots] : [],
    trackedOutcomes: { ...(historyState?.trackedOutcomes ?? {}) },
  }

  const trackedEntries = Object.entries(next.trackedOutcomes)
  const active = []
  const resolved = []
  for (const entry of trackedEntries) {
    const [, item] = entry
    const ts = new Date(item?.resolvedAt ?? item?.lastObservedAt ?? item?.createdAt ?? now).getTime()
    if (item?.resolvedAt) resolved.push([entry, ts])
    else active.push([entry, ts])
  }

  resolved.sort((a, b) => (b[1] || 0) - (a[1] || 0))
  active.sort((a, b) => (b[1] || 0) - (a[1] || 0))
  const keepResolved = new Set(resolved
    .filter(([, ts]) => Number.isFinite(ts) && (now - ts) <= MOONSHOT_LIMITS.history.trackedOutcomeMaxAgeMs)
    .slice(0, MOONSHOT_LIMITS.history.resolvedOutcomeKeep)
    .map(([[key]]) => key))
  const keepActive = new Set(active
    .slice(0, MOONSHOT_LIMITS.history.activeOutcomeKeep)
    .map(([[key]]) => key))

  for (const [key, item] of Object.entries(next.trackedOutcomes)) {
    if (item?.resolvedAt) {
      if (!keepResolved.has(key)) delete next.trackedOutcomes[key]
    } else if (!keepActive.has(key)) {
      delete next.trackedOutcomes[key]
    }
  }

  for (const [key, cooldown] of Object.entries(next.cooldowns)) {
    const untilTs = new Date(cooldown?.until ?? 0).getTime()
    if (!next.lastAlerts[key] && (!Number.isFinite(untilTs) || untilTs < now - MOONSHOT_LIMITS.cooldownMs.WATCH)) delete next.cooldowns[key]
  }

  return next
}

function writeHistory(value) {
  const next = pruneHistoryState(value)
  const tmpFile = `${MOONSHOT_HISTORY_FILE}.tmp`
  fs.writeFileSync(tmpFile, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmpFile, MOONSHOT_HISTORY_FILE)
}

function totalTxns(txns = {}) {
  return safeNumber(txns.buys) + safeNumber(txns.sells)
}

function sumScore(parts) {
  return Object.values(parts).reduce((sum, value) => sum + safeNumber(value), 0)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalize(value, low, high) {
  if (!Number.isFinite(value)) return 0
  if (high <= low) return value >= high ? 1 : 0
  return clamp((value - low) / (high - low), 0, 1)
}

function uniqueLinks(profile, boost) {
  const items = [...(profile?.links ?? []), ...(boost?.links ?? [])]
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item?.type ?? item?.label ?? 'link'}:${item?.url ?? ''}`
    if (!item?.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasBlockedKeyword(pair) {
  const haystack = `${pair?.baseToken?.name ?? ''} ${pair?.baseToken?.symbol ?? ''}`.toLowerCase()
  return BLOCKED_KEYWORDS.some((keyword) => haystack.includes(keyword))
}

function keyForCandidate(candidate) {
  return `${candidate.chainId}:${String(candidate.tokenAddress).toLowerCase()}`
}

function cooldownMsForLevel(level) {
  if (level === 'EXTREME') return MOONSHOT_LIMITS.cooldownMs.EXTREME
  if (level === 'HOT') return MOONSHOT_LIMITS.cooldownMs.HOT
  return MOONSHOT_LIMITS.cooldownMs.WATCH
}

function riskFlagsForPair(pair, score) {
  const flags = []
  const quote = String(pair?.quoteToken?.symbol ?? '').toUpperCase()
  if (!TRUSTED_QUOTES.has(quote)) flags.push(`弱 quote: ${quote || 'UNKNOWN'}`)
  if (safeNumber(pair?.liquidity?.usd) < 30000) flags.push('低流动性')
  if (safeNumber(pair?.fdv) > 0 && safeNumber(pair?.liquidity?.usd) > 0 && (safeNumber(pair?.fdv) / Math.max(1, safeNumber(pair?.liquidity?.usd))) > 80) flags.push('FDV/流动性偏高')
  if (safeNumber(score?.metrics?.changeH24) > 220) flags.push('24h 涨幅过大，谨防末端')
  if (hasBlockedKeyword(pair)) flags.push('命名可疑')
  return flags
}

function safetyPriority(verdict) {
  if (verdict === 'PASS') return 3
  if (verdict === 'WARN') return 2
  if (verdict === 'DOWNGRADE') return 1
  return 0
}

function lifecyclePriority(stage) {
  if (stage === 'CONFIRMED') return 4
  if (stage === 'HEATING') return 3
  if (stage === 'NEW') return 2
  if (stage === 'COOLING') return 1
  return 0
}

async function runSafetyChecks(pair, options = {}) {
  const provider = options.provider || process.env.MOONSHOT_SAFETY_PROVIDER || 'local-heuristic'
  const tokenAddress = String(pair?.baseToken?.address ?? '')
  if (provider === 'goplus') {
    const chainKey = String(pair?.chainId ?? '').toLowerCase()
    const chainNum = goplusChainId(chainKey)
    if (!chainNum) {
      return {
        provider,
        safeToWatch: false,
        checks: [
          { key: 'goplus_chain_support', passed: false, message: `GoPlus provider 暂不支持当前链 ${chainKey || 'unknown'}` }
        ],
        meta: { configured: true, implemented: false, target: `${GOPLUS_BASE}/api/v1/token_security/<chain>?contract_addresses=${tokenAddress}` }
      }
    }
    const target = `${GOPLUS_BASE}/api/v1/token_security/${chainNum}?contract_addresses=${tokenAddress}`
    try {
      const response = await fetchJson(target)
      const tokenInfo = response?.result?.[String(tokenAddress).toLowerCase()] ?? response?.result?.[tokenAddress] ?? null
      if (!tokenInfo) {
        return {
          provider,
          safeToWatch: false,
          checks: [
            { key: 'goplus_result', passed: false, message: 'GoPlus 返回为空或未命中 token 结果' }
          ],
          meta: { configured: true, implemented: true, target }
        }
      }
      const checks = [
        { key: 'cannot_buy', passed: !parseBooleanish(tokenInfo.cannot_buy), message: parseBooleanish(tokenInfo.cannot_buy) ? '不能买入' : '可买入' },
        { key: 'cannot_sell_all', passed: !parseBooleanish(tokenInfo.cannot_sell_all), message: parseBooleanish(tokenInfo.cannot_sell_all) ? '疑似不能全部卖出' : '未见全部卖出限制' },
        { key: 'is_honeypot', passed: !parseBooleanish(tokenInfo.is_honeypot), message: parseBooleanish(tokenInfo.is_honeypot) ? '疑似 honeypot' : '未标记 honeypot' },
        { key: 'buy_tax', passed: safeNumber(tokenInfo.buy_tax) <= 10, message: `buy tax ${safeNumber(tokenInfo.buy_tax)}%` },
        { key: 'sell_tax', passed: safeNumber(tokenInfo.sell_tax) <= 10, message: `sell tax ${safeNumber(tokenInfo.sell_tax)}%` },
        { key: 'is_blacklisted', passed: !parseBooleanish(tokenInfo.is_blacklisted), message: parseBooleanish(tokenInfo.is_blacklisted) ? '存在黑名单风险' : '未见黑名单风险' },
        { key: 'is_mintable', passed: !parseBooleanish(tokenInfo.is_mintable), message: parseBooleanish(tokenInfo.is_mintable) ? '合约可增发' : '未见增发能力' },
        { key: 'hidden_owner', passed: !parseBooleanish(tokenInfo.hidden_owner), message: parseBooleanish(tokenInfo.hidden_owner) ? '存在 hidden owner 风险' : '未见 hidden owner' },
        { key: 'is_proxy', passed: !parseBooleanish(tokenInfo.is_proxy), message: parseBooleanish(tokenInfo.is_proxy) ? '代理合约' : '非代理合约' },
        { key: 'is_open_source', passed: parseBooleanish(tokenInfo.is_open_source) || tokenInfo.is_open_source == 1 || tokenInfo.is_open_source == '1', message: (parseBooleanish(tokenInfo.is_open_source) || tokenInfo.is_open_source == 1 || tokenInfo.is_open_source == '1') ? '已开源' : '未开源/未知' },
        { key: 'owner_change_balance', passed: !parseBooleanish(tokenInfo.owner_change_balance), message: parseBooleanish(tokenInfo.owner_change_balance) ? 'owner 可改余额' : '未见 owner 改余额能力' },
        { key: 'can_take_back_ownership', passed: !parseBooleanish(tokenInfo.can_take_back_ownership), message: parseBooleanish(tokenInfo.can_take_back_ownership) ? '可取回 ownership' : '未见可取回 ownership' },
        { key: 'transfer_pausable', passed: !parseBooleanish(tokenInfo.transfer_pausable), message: parseBooleanish(tokenInfo.transfer_pausable) ? '可暂停转账' : '未见可暂停转账' },
      ]
      const hardBlock = checks.some((item) => ['cannot_sell_all', 'is_honeypot', 'is_blacklisted', 'owner_change_balance'].includes(item.key) && !item.passed)
      const caution = checks.some((item) => ['buy_tax', 'sell_tax', 'is_mintable', 'hidden_owner', 'is_proxy', 'can_take_back_ownership', 'transfer_pausable', 'is_open_source'].includes(item.key) && !item.passed)
      return {
        provider,
        safeToWatch: !hardBlock && (!caution || checks.filter((item) => item.passed).length >= 6),
        checks,
        meta: { configured: true, implemented: true, target }
      }
    } catch (error) {
      return {
        provider,
        safeToWatch: false,
        checks: [
          { key: 'goplus_fetch_error', passed: false, message: `GoPlus 请求失败：${error?.message ?? error}` }
        ],
        meta: { configured: true, implemented: false, target }
      }
    }
  }
  if (provider !== 'local-heuristic') {
    return {
      provider,
      safeToWatch: false,
      checks: [
        { key: 'provider_not_implemented', passed: false, message: `provider ${provider} 已配置但尚未实现，当前回退前请先接入真实检查逻辑` }
      ],
      meta: { configured: true, implemented: false }
    }
  }
  const checks = []
  const quote = String(pair?.quoteToken?.symbol ?? '').toUpperCase()
  const liquidityUsd = safeNumber(pair?.liquidity?.usd)
  checks.push({ key: 'trusted_quote', passed: TRUSTED_QUOTES.has(quote), message: TRUSTED_QUOTES.has(quote) ? `quote ${quote} 较可信` : `quote ${quote || 'UNKNOWN'} 偏弱` })
  checks.push({ key: 'min_liquidity', passed: liquidityUsd >= 30000, message: liquidityUsd >= 30000 ? `流动性 ${Math.round(liquidityUsd)}` : `流动性偏低 ${Math.round(liquidityUsd)}` })
  checks.push({ key: 'name_sanity', passed: !hasBlockedKeyword(pair), message: !hasBlockedKeyword(pair) ? '命名未见明显异常' : '命名存在可疑关键词' })
  return {
    provider: 'local-heuristic',
    safeToWatch: checks.every((item) => item.passed) || checks.filter((item) => item.passed).length >= 2,
    checks,
    meta: { configured: true, implemented: true }
  }
}

function computeRaveLikeProfile(pair, score) {
  const liquidityUsd = safeNumber(pair?.liquidity?.usd)
  const volumeH1 = safeNumber(score?.metrics?.volumeH1)
  const txnsH1 = safeNumber(score?.metrics?.txnsH1)
  const changeH24 = safeNumber(score?.metrics?.changeH24)
  const trustedQuote = TRUSTED_QUOTES.has(String(pair?.quoteToken?.symbol ?? '').toUpperCase())
  const acceleration = score?.acceleration ?? {}
  const parts = {
    deepLiquidity: normalize(liquidityUsd, 80000, 500000) * 24,
    strongVolume: normalize(volumeH1, 50000, 250000) * 22,
    strongActivity: normalize(txnsH1, 150, 1600) * 20,
    trustedQuote: trustedQuote ? 10 : 0,
    breakout: acceleration.breakout ? 10 : 0,
    acceleration: normalize(acceleration.volumeH1Ratio, 1.1, 2.2) * 8 + normalize(acceleration.txnsH1Ratio, 1.1, 2.0) * 6,
    notTooLate: (changeH24 <= 180 ? 10 : changeH24 <= 260 ? 4 : 0),
  }
  const total = clamp(Math.round(sumScore(parts)), 0, 100)
  let label = 'WEAK'
  if (total >= 78) label = 'STRONG'
  else if (total >= 58) label = 'MEDIUM'
  const reasons = []
  if (liquidityUsd >= 80000) reasons.push('流动性够深')
  if (volumeH1 >= 50000) reasons.push('1h 成交额强')
  if (txnsH1 >= 150) reasons.push('1h 交易活跃')
  if (acceleration.breakout) reasons.push('出现 breakout')
  if (trustedQuote) reasons.push('可信 quote')
  if (changeH24 > 220) reasons.push('可能偏末端')
  return { total, label, reasons, parts }
}

function computeAcceleration(snapshotSeries = [], currentMetrics = {}) {
  const prev = snapshotSeries[snapshotSeries.length - 1] ?? null
  const prev3 = snapshotSeries.length >= 3 ? snapshotSeries[snapshotSeries.length - 3] : prev
  if (!prev) {
    return {
      scoreDelta: 0,
      volumeH1Ratio: 1,
      txnsH1Ratio: 1,
      liquidityRatio: 1,
      changeH1Delta: 0,
      sustainedScans: 0,
      upgraded: false,
      breakout: false,
    }
  }
  const sustainedScans = snapshotSeries.filter((item) => safeNumber(item.scoreTotal) >= 68).length
  const volumeH1Ratio = safeNumber(currentMetrics.volumeH1) / Math.max(1, safeNumber(prev.metrics?.volumeH1))
  const txnsH1Ratio = safeNumber(currentMetrics.txnsH1) / Math.max(1, safeNumber(prev.metrics?.txnsH1))
  const liquidityRatio = safeNumber(currentMetrics.liquidityUsd) / Math.max(1, safeNumber(prev.metrics?.liquidityUsd))
  const scoreDelta = safeNumber(currentMetrics.scoreTotal) - safeNumber(prev.scoreTotal)
  const changeH1Delta = safeNumber(currentMetrics.changeH1) - safeNumber(prev.metrics?.changeH1)
  const breakout = (safeNumber(currentMetrics.volumeH1) / Math.max(1, safeNumber(prev3?.metrics?.volumeH1))) >= 1.8 && (safeNumber(currentMetrics.txnsH1) / Math.max(1, safeNumber(prev3?.metrics?.txnsH1))) >= 1.5
  return {
    scoreDelta,
    volumeH1Ratio,
    txnsH1Ratio,
    liquidityRatio,
    changeH1Delta,
    sustainedScans,
    upgraded: safeNumber(currentMetrics.scoreTotal) >= 82 && safeNumber(prev.scoreTotal) < 82,
    breakout,
  }
}

function scoreCandidate(pair, boost = null, profile = null, history = []) {
  const liquidityUsd = safeNumber(pair?.liquidity?.usd)
  const volumeM5 = safeNumber(pair?.volume?.m5)
  const volumeH1 = safeNumber(pair?.volume?.h1)
  const volumeH6 = safeNumber(pair?.volume?.h6)
  const volumeH24 = safeNumber(pair?.volume?.h24)
  const txnsM5 = totalTxns(pair?.txns?.m5)
  const txnsH1 = totalTxns(pair?.txns?.h1)
  const txnsH6 = totalTxns(pair?.txns?.h6)
  const changeM5 = safeNumber(pair?.priceChange?.m5)
  const changeH1 = safeNumber(pair?.priceChange?.h1)
  const changeH6 = safeNumber(pair?.priceChange?.h6)
  const changeH24 = safeNumber(pair?.priceChange?.h24)
  const boostAmount = safeNumber(boost?.totalAmount ?? boost?.amount)
  const links = uniqueLinks(profile, boost)
  const hasSocials = links.length >= 2 ? 1 : links.length === 1 ? 0.5 : 0
  const ageHours = pair?.pairCreatedAt ? (Date.now() - Number(pair.pairCreatedAt)) / 36e5 : null
  const trustedQuote = TRUSTED_QUOTES.has(String(pair?.quoteToken?.symbol ?? '').toUpperCase()) ? 1 : 0

  const parts = {
    liquidity: normalize(liquidityUsd, 30000, 300000) * 20,
    volume: normalize(volumeH1, 15000, 250000) * 18 + normalize(volumeH6, 60000, 1000000) * 8,
    activity: normalize(txnsH1, 60, 1200) * 16 + normalize(txnsM5, 5, 120) * 6,
    momentum: normalize(changeH1, 4, 30) * 12 + normalize(changeH6, 12, 80) * 10 + normalize(changeM5, 1, 12) * 4,
    acceleration: normalize(volumeM5 > 0 ? (volumeM5 * 12) / Math.max(volumeH1, 1) : 0, 0.25, 1.2) * 8,
    persistence: normalize(changeH24, 15, 180) * 6,
    socials: hasSocials * 4,
    boost: normalize(boostAmount, 50, 500) * 8,
    quoteQuality: trustedQuote * 4,
    freshness: ageHours == null ? 2 : ageHours <= 48 ? 8 : ageHours <= 7 * 24 ? 5 : 2,
  }

  const baseTotal = clamp(Math.round(sumScore(parts) - sumScore({
    lowLiquidity: liquidityUsd < 20000 ? 25 : 0,
    lowVolume: volumeH1 < 8000 ? 20 : 0,
    weakActivity: txnsH1 < 30 ? 18 : 0,
    overextended: changeH24 > 350 ? 10 : 0,
    microPool: liquidityUsd < 10000 ? 20 : 0,
    weakQuote: trustedQuote ? 0 : 12,
    blockedKeyword: hasBlockedKeyword(pair) ? 30 : 0,
  })), 0, 100)

  const accelerationMetrics = computeAcceleration(history, {
    volumeH1,
    txnsH1,
    liquidityUsd,
    changeH1,
    scoreTotal: baseTotal,
  })

  const accelerationBonus = clamp(Math.round(
    normalize(accelerationMetrics.volumeH1Ratio, 1.05, 2.2) * 8 +
    normalize(accelerationMetrics.txnsH1Ratio, 1.05, 2.0) * 6 +
    normalize(accelerationMetrics.scoreDelta, 4, 18) * 5 +
    normalize(accelerationMetrics.changeH1Delta, 2, 12) * 4 +
    (accelerationMetrics.breakout ? 5 : 0)
  ), 0, 18)

  const penalties = {
    lowLiquidity: liquidityUsd < 20000 ? 25 : 0,
    lowVolume: volumeH1 < 8000 ? 20 : 0,
    weakActivity: txnsH1 < 30 ? 18 : 0,
    overextended: changeH24 > 350 ? 10 : 0,
    microPool: liquidityUsd < 10000 ? 20 : 0,
    weakQuote: trustedQuote ? 0 : 12,
    blockedKeyword: hasBlockedKeyword(pair) ? 30 : 0,
  }

  const total = clamp(baseTotal + accelerationBonus, 0, 100)

  let level = 'WATCH'
  if (total >= 84) level = 'EXTREME'
  else if (total >= 68) level = 'HOT'

  const reasons = []
  if (changeH1 >= 8) reasons.push(`1h 涨幅 ${changeH1.toFixed(1)}%`)
  if (changeH6 >= 20) reasons.push(`6h 涨幅 ${changeH6.toFixed(1)}%`)
  if (volumeH1 >= 50000) reasons.push(`1h 成交额 $${Math.round(volumeH1).toLocaleString()}`)
  if (txnsH1 >= 150) reasons.push(`1h 交易数 ${Math.round(txnsH1)}`)
  if (liquidityUsd >= 80000) reasons.push(`流动性 $${Math.round(liquidityUsd).toLocaleString()}`)
  if (boostAmount > 0) reasons.push(`Dex boost ${boostAmount}`)
  if (accelerationMetrics.volumeH1Ratio >= 1.4) reasons.push(`1h 成交加速 ${accelerationMetrics.volumeH1Ratio.toFixed(2)}x`)
  if (accelerationMetrics.txnsH1Ratio >= 1.3) reasons.push(`1h 交易加速 ${accelerationMetrics.txnsH1Ratio.toFixed(2)}x`)
  if (accelerationMetrics.upgraded) reasons.push('评分升级到 EXTREME')
  if (accelerationMetrics.breakout) reasons.push('连续扫描出现 breakout')

  return {
    total,
    level,
    parts: { ...parts, accelerationHistory: accelerationBonus },
    penalties,
    reasons,
    metrics: {
      liquidityUsd,
      volumeM5,
      volumeH1,
      volumeH6,
      volumeH24,
      txnsM5,
      txnsH1,
      txnsH6,
      changeM5,
      changeH1,
      changeH6,
      changeH24,
      boostAmount,
      ageHours,
    },
    acceleration: accelerationMetrics,
  }
}

function deriveSafetyDecision(candidate) {
  const safety = candidate.safety ?? { safeToWatch: false, checks: [], meta: {} }
  const failed = (safety.checks ?? []).filter((item) => !item.passed)
  const failedKeys = failed.map((item) => item.key)
  const has = (keys = []) => failed.some((item) => keys.includes(item.key))

  const hardBlock = has(['name_sanity', 'provider_not_implemented', 'cannot_buy', 'cannot_sell_all', 'is_honeypot', 'is_blacklisted', 'owner_change_balance'])
  if (hardBlock) return { verdict: 'BLOCK', reason: failedKeys.join(', ') || 'hard block' }

  const severeGovernance = has(['hidden_owner', 'can_take_back_ownership', 'transfer_pausable'])
  const severeTokenomics = has(['is_mintable'])
  const severeTax = safeNumber(candidate?.safety?.checks?.find((item) => item.key === 'buy_tax')?.message?.match(/(\d+(?:\.\d+)?)/)?.[1]) > 15
    || safeNumber(candidate?.safety?.checks?.find((item) => item.key === 'sell_tax')?.message?.match(/(\d+(?:\.\d+)?)/)?.[1]) > 15
  const downgrade = !safety.safeToWatch || severeGovernance || severeTokenomics || severeTax || candidate.riskFlags?.includes('低流动性')
  if (downgrade) return { verdict: 'DOWNGRADE', reason: failedKeys.join(', ') || 'safety downgrade' }

  const warn = has(['buy_tax', 'sell_tax', 'is_proxy', 'is_open_source', 'goplus_fetch_error', 'goplus_result'])
  if (warn) return { verdict: 'WARN', reason: failedKeys.join(', ') || 'safety warn' }

  return { verdict: 'PASS', reason: 'safety ok' }
}

function effectiveLevel(candidate) {
  const safetyDecision = deriveSafetyDecision(candidate)
  if (safetyDecision.verdict === 'BLOCK') return 'WATCH'
  if (safetyDecision.verdict === 'DOWNGRADE' && candidate.score.level === 'EXTREME') return 'HOT'
  return candidate.score.level
}

function deriveLifecycleStage(candidate, historyState) {
  const key = keyForCandidate(candidate)
  const series = historyState?.snapshots?.[key] ?? []
  const prev = series[series.length - 1] ?? null
  const score = safeNumber(candidate?.score?.total)
  const scoreDelta = safeNumber(candidate?.score?.acceleration?.scoreDelta)
  const breakout = candidate?.score?.acceleration?.breakout === true
  const sustained = safeNumber(candidate?.score?.acceleration?.sustainedScans)
  const prevLevel = prev?.level ?? null
  const prevScore = safeNumber(prev?.scoreTotal)
  const previousStage = prev?.lifecycleStage ?? null

  let stage = 'NEW'
  let reason = '首次进入观察区间或刚冒头'
  if (score >= 84 && (breakout || sustained >= 2 || prevLevel === 'EXTREME' || prevScore >= 78)) {
    stage = 'CONFIRMED'
    reason = breakout ? 'breakout 确认' : sustained >= 2 ? '连续强扫描确认' : '已进入持续强势区间'
  } else if (score >= 68 && (scoreDelta >= 4 || prevLevel === 'HOT' || prevScore >= 64)) {
    stage = 'HEATING'
    reason = scoreDelta >= 4 ? '评分持续抬升' : '已进入持续加热区间'
  } else if (series.length >= 2 && (prevLevel === 'HOT' || prevLevel === 'EXTREME' || prevScore >= 68) && score < prevScore) {
    stage = 'COOLING'
    reason = '相对前序扫描开始回落'
  }

  const changed = Boolean(previousStage && previousStage !== stage)
  const stageSinceAt = changed ? candidate?.scannedAt ?? new Date().toISOString() : (prev?.stageSinceAt ?? prev?.scannedAt ?? null)
  return {
    stage,
    reason,
    previousStage,
    changed,
    transitionLabel: previousStage ? `${previousStage} → ${stage}` : `INIT → ${stage}`,
    stageSinceAt,
  }
}

function classifyAlertStage(candidate, historyState) {
  const key = keyForCandidate(candidate)
  const currentLevel = effectiveLevel(candidate)
  const lastLevel = historyState.lastAlerts?.[key]?.level ?? null
  const cooldown = historyState.cooldowns?.[key] ?? null
  const inCooldown = cooldown?.until && new Date(cooldown.until).getTime() > Date.now()
  const rearmed = cooldown?.rearmed === true
  const sustained = safeNumber(candidate.score?.acceleration?.sustainedScans)
  const breakout = candidate.score?.acceleration?.breakout === true
  const strongConfirm = breakout || sustained >= 2 || safeNumber(candidate.score?.acceleration?.volumeH1Ratio) >= 1.5

  if (inCooldown && !rearmed) return null
  if (currentLevel === 'EXTREME') {
    if (lastLevel !== 'EXTREME' || breakout || rearmed) return strongConfirm ? 'CONFIRM' : 'EARLY'
    return null
  }
  if (currentLevel === 'HOT') {
    if (lastLevel == null || lastLevel === 'WATCH' || rearmed) return 'EARLY'
    if (strongConfirm && lastLevel === 'HOT') return 'CONFIRM'
  }
  return null
}

function classifyLifecycleTransitionAlert(candidate, historyState) {
  const key = keyForCandidate(candidate)
  const lifecycle = candidate.lifecycle ?? {}
  const prevStage = lifecycle.previousStage ?? null
  const nextStage = lifecycle.stage ?? null
  const changed = lifecycle.changed === true
  const cooldown = historyState.cooldowns?.[key] ?? null
  const inCooldown = cooldown?.until && new Date(cooldown.until).getTime() > Date.now()
  const rearmed = cooldown?.rearmed === true
  const lastTransition = historyState.lastAlerts?.[key]?.transitionLabel ?? null
  const transitionLabel = lifecycle.transitionLabel ?? null
  const safetyDecision = deriveSafetyDecision(candidate)
  const breakout = candidate.score?.acceleration?.breakout === true
  const sustained = safeNumber(candidate.score?.acceleration?.sustainedScans)
  const score = safeNumber(candidate.score?.total)

  if (!changed || !prevStage || !nextStage || !transitionLabel) return null
  if (lastTransition === transitionLabel && inCooldown && !rearmed) return null

  if (prevStage === 'NEW' && nextStage === 'HEATING') {
    const actionReady = safetyDecision.verdict === 'PASS' && score >= 72
    return {
      stage: 'TRANSITION_HEATING',
      severity: actionReady ? 'MEDIUM' : 'LOW',
      kind: actionReady ? 'LIVE_SMALL' : 'RISK_ALERT',
      priority: actionReady ? 70 : 45,
      tone: actionReady ? 'WATCH' : 'RISK',
      reason: actionReady ? '进入加热区，且质量尚可' : '进入加热区，但安全性/质量一般'
    }
  }
  if (prevStage === 'HEATING' && nextStage === 'CONFIRMED') {
    const topTier = safetyDecision.verdict === 'PASS' && (breakout || sustained >= 2) && score >= 84
    const midTier = safetyDecision.verdict !== 'DOWNGRADE' && score >= 80
    return {
      stage: 'TRANSITION_CONFIRMED',
      severity: topTier ? 'HIGH' : midTier ? 'MEDIUM' : 'LOW',
      kind: topTier ? 'LIVE_OK' : midTier ? 'LIVE_SMALL' : 'RISK_ALERT',
      priority: topTier ? 100 : midTier ? 78 : 52,
      tone: topTier ? 'ACTION' : midTier ? 'WATCH' : 'RISK',
      reason: topTier ? '确认段 + breakout/持续强化 + Safety PASS' : midTier ? '进入确认段，但还不是最强形态' : '进入确认段，但质量不足以强提醒'
    }
  }
  if (prevStage === 'CONFIRMED' && nextStage === 'COOLING') {
    const risky = safetyDecision.verdict === 'DOWNGRADE' || score < 78 || !candidate.safety?.safeToWatch
    return {
      stage: 'TRANSITION_COOLING',
      severity: risky ? 'HIGH' : 'MEDIUM',
      kind: 'RISK_ALERT',
      priority: risky ? 88 : 60,
      tone: 'RISK',
      reason: risky ? '确认后回落，且伴随质量不足/安全性走弱' : '确认后进入降温阶段'
    }
  }
  return null
}

function shouldEmitAlert(candidate, historyState) {
  return classifyAlertStage(candidate, historyState) != null || classifyLifecycleTransitionAlert(candidate, historyState) != null
}

function shouldKeepCandidate(candidate) {
  const safetyDecision = deriveSafetyDecision(candidate)
  if (safetyDecision.verdict === 'BLOCK') return false
  if (candidate.score.total < MOONSHOT_LIMITS.keepCandidateScoreMin) return false
  if (safetyDecision.verdict === 'DOWNGRADE' && (candidate.raveLike?.total ?? 0) < MOONSHOT_LIMITS.keepCandidateDowngradeRaveMin && candidate.score.total < MOONSHOT_LIMITS.keepCandidateDowngradeScoreMin) return false
  return true
}

function buildDecisionLine(candidate, transitionMeta) {
  const tone = transitionMeta?.tone ?? candidate.lifecycle?.transitionTone ?? 'WATCH'
  const reason = transitionMeta?.reason ?? candidate.lifecycle?.transitionReason ?? candidate.lifecycle?.reason ?? '继续观察'
  if (tone === 'ACTION') return `可优先复核：${reason}`
  if (tone === 'RISK') return `谨慎：${reason}`
  return `先观察：${reason}`
}

function buildTimingHint(candidate, transitionMeta) {
  const tone = transitionMeta?.tone ?? candidate.lifecycle?.transitionTone ?? 'WATCH'
  const stage = candidate.lifecycle?.stage ?? 'NEW'
  const breakout = candidate.score?.acceleration?.breakout === true
  const changed = candidate.lifecycle?.changed === true

  if (tone === 'ACTION') return breakout || changed ? '时机建议：现在适合立刻复核。' : '时机建议：尽量在本轮内完成复核。'
  if (tone === 'RISK') return stage === 'COOLING' ? '时机建议：短期内以风险观察为主，先别急着追。' : '时机建议：先放观察名单，暂不作为进攻候选。'
  return changed ? '时机建议：等下一轮扫描，确认是否继续强化。' : '时机建议：先继续盯，暂时不用立刻处理。'
}

function buildExecutionTier(candidate, transitionMeta) {
  const tone = transitionMeta?.tone ?? candidate.lifecycle?.transitionTone ?? 'WATCH'
  const priority = transitionMeta?.priority ?? candidate.lifecycle?.transitionPriority ?? 0
  const safety = deriveSafetyDecision(candidate).verdict
  const breakout = candidate.score?.acceleration?.breakout === true
  const score = safeNumber(candidate.score?.total)

  if (tone === 'ACTION' && safety === 'PASS' && priority >= 90 && (breakout || score >= 86)) return 'A'
  if ((tone === 'ACTION' || tone === 'WATCH') && safety !== 'DOWNGRADE' && priority >= 70) return 'B'
  if (tone === 'WATCH' && priority >= 45) return 'C'
  return 'R'
}

function buildFeedbackCopyPolicy(candidate, feedback) {
  const confidence = safeNumber(feedback?.confidence)
  const label = feedback?.label ?? 'NO_SIGNAL'
  const reversalActive = feedback?.reversalActive === true
  const fallbackDepth = safeNumber(feedback?.fallbackDepth)
  const mode = feedback?.calibrationMode ?? 'INSUFFICIENT_SAMPLE'

  let posture = 'NEUTRAL'
  let decisionPrefix = ''
  let timing = null
  let note = null

  if (reversalActive) {
    posture = 'DEFENSIVE'
    decisionPrefix = '反馈转弱：'
    timing = '反馈文案：近期命中组合连续走坏，先降级处理，不把它当成稳定进攻样本。'
    note = '近期 reversal active：历史正反馈暂时降权，优先看是否继续失效。'
  } else if (label === 'POSITIVE_EDGE' && confidence >= 0.65 && fallbackDepth <= 2) {
    posture = 'CONFIDENT_ACTION'
    decisionPrefix = '反馈确认：'
    timing = '反馈文案：历史反馈较硬，当前可按确认候选优先复核。'
    note = '高置信正反馈：可更明确强调确认、执行等级和本轮复核。'
  } else if ((label === 'POSITIVE_EDGE' || label === 'UPSIDE_EDGE') && confidence >= 0.4) {
    posture = 'SOFT_ACTION'
    decisionPrefix = '反馈偏正：'
    timing = fallbackDepth >= 3
      ? '反馈文案：历史偏正，但当前主要来自上层 fallback，只适合作弱参考。'
      : '反馈文案：历史偏正，可轻度强化，但先别把它说得太满。'
    note = fallbackDepth >= 3
      ? '弱正反馈：可提示有利历史，但要明确这是结构近似，不是强匹配。'
      : '中等正反馈：语气可稍偏进攻，但仍保留确认空间。'
  } else if (label === 'NEGATIVE_EDGE' && confidence >= 0.4) {
    posture = 'RISK_ALERT'
    decisionPrefix = '反馈压制：'
    timing = '反馈文案：历史失败率偏高，这类更适合风险观察，不宜用强进攻语气。'
    note = '负反馈生效：强调风险迁移、压制原因和避免追高。'
  } else if (confidence < 0.35 || mode === 'INSUFFICIENT_SAMPLE') {
    posture = 'LOW_CONFIDENCE'
    decisionPrefix = '弱参考：'
    timing = '反馈文案：当前历史样本偏弱，只能给轻提示，不作为强判断依据。'
    note = '低置信：文案要明确“仅弱参考”，避免假装系统很确定。'
  }

  return { posture, decisionPrefix, timing, note }
}

function poolCategory(candidate) {
  const tone = candidate.lifecycle?.transitionTone ?? 'WATCH'
  const priority = candidate.lifecycle?.transitionPriority ?? 0
  const safety = deriveSafetyDecision(candidate).verdict
  const score = safeNumber(candidate.score?.total)
  const rave = safeNumber(candidate.raveLike?.total)

  if (tone === 'ACTION' && safety === 'PASS' && priority >= 78 && score >= 80 && rave >= 58) return 'PRIME_POOL'
  if (tone === 'WATCH' && safety !== 'BLOCK' && score >= 60) return 'EARLY_POOL'
  if (tone === 'RISK' && priority >= 80 && candidate.lifecycle?.stage === 'COOLING') return 'RISK_POOL'
  return 'GENERAL'
}

function summarizeMarketRegime(candidates = []) {
  const total = candidates.length || 1
  const tierA = candidates.filter((item) => item.lifecycle?.executionTier === 'A').length
  const tierB = candidates.filter((item) => item.lifecycle?.executionTier === 'B').length
  const tierC = candidates.filter((item) => item.lifecycle?.executionTier === 'C').length
  const tierR = candidates.filter((item) => item.lifecycle?.executionTier === 'R' || !item.lifecycle?.executionTier).length
  const prime = candidates.filter((item) => poolCategory(item) === 'PRIME_POOL').length
  const early = candidates.filter((item) => poolCategory(item) === 'EARLY_POOL').length
  const risk = candidates.filter((item) => poolCategory(item) === 'RISK_POOL').length
  const action = candidates.filter((item) => item.lifecycle?.transitionTone === 'ACTION').length
  const watch = candidates.filter((item) => item.lifecycle?.transitionTone === 'WATCH').length
  const riskTone = candidates.filter((item) => item.lifecycle?.transitionTone === 'RISK').length

  let tone = 'WATCH'
  let title = '当前偏观察'
  let body = '市场更像观察窗口，先盯 B/C 级与预警池样本，等待进一步升级确认。'

  if ((tierA + tierB) / total >= 0.45 && prime >= risk && action >= riskTone) {
    tone = 'ACTION'
    title = '当前偏进攻'
    body = 'A/B 级候选占比上升，精选池样本不弱，适合优先看强确认与持续强化标的。'
  } else if (tierR / total >= 0.35 || risk > prime || riskTone > action) {
    tone = 'RISK'
    title = '当前偏防守'
    body = 'R 级或风险迁移占比抬升，先以防追高、防假突破、防回落误判为主。'
  }

  return {
    tone,
    title,
    body,
    metrics: { tierA, tierB, tierC, tierR, prime, early, risk, action, watch, riskTone, total },
  }
}

function regimeToneStrength(regime) {
  const metrics = regime?.metrics ?? {}
  const total = Math.max(1, safeNumber(metrics.total, 1))
  const tierABShare = (safeNumber(metrics.tierA) + safeNumber(metrics.tierB)) / total
  const tierRShare = safeNumber(metrics.tierR) / total
  const primeLead = safeNumber(metrics.prime) - safeNumber(metrics.risk)
  const actionLead = safeNumber(metrics.action) - safeNumber(metrics.riskTone)

  if (regime?.tone === 'ACTION') {
    return clamp(Math.round(tierABShare * 100 + primeLead * 8 + actionLead * 6), 0, 100)
  }
  if (regime?.tone === 'RISK') {
    return clamp(Math.round(tierRShare * 100 + (-primeLead) * 8 + (-actionLead) * 6), 0, 100)
  }
  return clamp(Math.round((safeNumber(metrics.watch) / total) * 70 + Math.abs(actionLead) * 3), 0, 100)
}

function regimeShiftStrengthLabel(score = 0) {
  if (score >= 75) return 'STRONG'
  if (score >= 45) return 'MEDIUM'
  return 'LIGHT'
}

function analyzeRegimeHistory(history = [], currentRegime = null) {
  const recent = [...history].slice(-6)
  const tones = recent.map((item) => item?.tone).filter(Boolean)
  const currentTone = currentRegime?.tone ?? recent[recent.length - 1]?.tone ?? 'WATCH'
  let sameToneStreak = 0
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (recent[i]?.tone === currentTone) sameToneStreak += 1
    else break
  }

  let flipsLast4 = 0
  const last4 = tones.slice(-4)
  for (let i = 1; i < last4.length; i += 1) {
    if (last4[i] !== last4[i - 1]) flipsLast4 += 1
  }

  const prevTone = recent[recent.length - 2]?.tone ?? null
  const fakeShift = recent.length >= 3
    && recent[recent.length - 3]?.tone === currentTone
    && prevTone != null
    && prevTone !== currentTone

  return {
    sameToneStreak,
    flipsLast4,
    fakeShift,
  }
}

function computeRegimeShift(currentRegime, previousRegime, history = []) {
  if (!currentRegime) return null
  const currentStrength = regimeToneStrength(currentRegime)
  const previousStrength = regimeToneStrength(previousRegime)
  const historyMeta = analyzeRegimeHistory(history, currentRegime)
  const strengthDelta = currentStrength - previousStrength
  const strengthLabel = regimeShiftStrengthLabel(Math.abs(strengthDelta) + (currentRegime.tone !== previousRegime?.tone ? 18 : 0))

  if (!previousRegime) {
    return {
      label: '初始节奏',
      direction: 'INIT',
      tone: currentRegime.tone,
      body: '这是首个节奏快照，先继续积累几轮扫描，再判断是否出现明确切换。',
      strengthScore: currentStrength,
      strengthLabel,
      sameToneStreak: historyMeta.sameToneStreak,
      flipsLast4: historyMeta.flipsLast4,
      fakeShift: false,
    }
  }

  const prevTone = previousRegime.tone ?? 'WATCH'
  const currTone = currentRegime.tone ?? 'WATCH'
  const prevMetrics = previousRegime.metrics ?? {}
  const currMetrics = currentRegime.metrics ?? {}
  const actionDelta = (currMetrics.action ?? 0) - (prevMetrics.action ?? 0)
  const riskDelta = (currMetrics.riskTone ?? 0) - (prevMetrics.riskTone ?? 0)
  const primeDelta = (currMetrics.prime ?? 0) - (prevMetrics.prime ?? 0)
  const riskPoolDelta = (currMetrics.risk ?? 0) - (prevMetrics.risk ?? 0)
  const tierABDelta = ((currMetrics.tierA ?? 0) + (currMetrics.tierB ?? 0)) - ((prevMetrics.tierA ?? 0) + (prevMetrics.tierB ?? 0))

  const attachMeta = (payload) => ({
    ...payload,
    strengthScore: currentStrength,
    strengthDelta,
    strengthLabel,
    sameToneStreak: historyMeta.sameToneStreak,
    flipsLast4: historyMeta.flipsLast4,
    fakeShift: historyMeta.fakeShift,
  })

  if (prevTone !== currTone) {
    if (currTone === 'ACTION') {
      return attachMeta({
        label: `节奏切换：${prevTone} → ACTION`,
        direction: 'UPSHIFT',
        tone: 'ACTION',
        body: historyMeta.fakeShift
          ? '这次转进攻更像一次回切确认：前一轮短暂偏离后又回到进攻区，说明原强势结构仍在。'
          : '从观察/防守切到进攻区，说明高质量候选、ACTION tone 或精选池正在抬升，值得提高复核优先级。'
      })
    }
    if (currTone === 'RISK') {
      return attachMeta({
        label: `节奏切换：${prevTone} → RISK`,
        direction: 'DOWNSHIFT',
        tone: 'RISK',
        body: historyMeta.fakeShift
          ? '这次转防守更像回落确认：前一轮短暂回暖后又掉回风险区，先别把它当成恢复。'
          : '从进攻/观察切到防守区，说明风险池或 R tone 正在抬升，先把重点放回防追高与降温确认。'
      })
    }
    return attachMeta({
      label: `节奏切换：${prevTone} → WATCH`,
      direction: 'NEUTRALIZE',
      tone: 'WATCH',
      body: '市场从单边倾向回到观察区，说明结构还没给出足够强的连续性，先等下一轮确认。'
    })
  }

  if (currTone === 'ACTION' && (tierABDelta >= 2 || primeDelta >= 1 || actionDelta >= 1)) {
    return attachMeta({
      label: '节奏强化：进攻继续增强',
      direction: 'STRENGTHENING',
      tone: 'ACTION',
      body: '进攻态没有变，但 A/B、精选池或 ACTION tone 继续抬升，更像强者恒强而不是一次性噪音。'
    })
  }
  if (currTone === 'RISK' && (riskPoolDelta >= 1 || riskDelta >= 1)) {
    return attachMeta({
      label: '节奏恶化：防守继续增强',
      direction: 'WEAKENING',
      tone: 'RISK',
      body: '防守态没有变，但风险池或 RISK tone 还在堆积，先别把回落错看成新机会。'
    })
  }

  return attachMeta({
    label: '节奏延续：维持原判断',
    direction: 'STABLE',
    tone: currTone,
    body: currTone === 'WATCH'
      ? '观察态继续维持，说明现在更像等待确认而不是立即切打法。'
      : currTone === 'ACTION'
        ? '仍偏进攻，但还没出现更强的新强化信号。'
        : '仍偏防守，但暂时没有进一步恶化。'
  })
}

function buildRegimePlaybook(regime, shift) {
  const tone = regime?.tone ?? 'WATCH'
  const strength = shift?.strengthLabel ?? 'LIGHT'
  const fakeShift = shift?.fakeShift === true
  const flips = safeNumber(shift?.flipsLast4)

  if (tone === 'ACTION') {
    return {
      mode: strength === 'STRONG' ? 'PRESS_ADVANTAGE' : 'SELECTIVE_ATTACK',
      focusPool: 'PRIME_POOL',
      alertBias: strength === 'STRONG' ? 'A_B_FIRST' : 'B_FIRST',
      reviewCadence: strength === 'STRONG' ? 'FAST' : 'NORMAL',
      title: strength === 'STRONG' ? '当前打法：优先进攻' : '当前打法：选择性进攻',
      body: fakeShift
        ? '虽然当前回到进攻区，但这次更像回切确认，优先看真正还在强化的 Prime Pool，不要把所有反弹都当成继续趋势。'
        : strength === 'STRONG'
          ? '优先扫 Prime Pool 和 A/B 级，人工复核节奏可以更快，先抓强确认和持续强化样本。'
          : '以 Prime Pool 为主，B 级优先于 C 级，保持进攻但不要把观察池当成主战场。',
      rankingMode: strength === 'STRONG' ? 'BREAKOUT_MOMENTUM' : 'QUALITY_MOMENTUM',
      alertPolicy: strength === 'STRONG' ? 'AGGRESSIVE_ACTION' : 'BALANCED_ACTION'
    }
  }

  if (tone === 'RISK') {
    return {
      mode: strength === 'STRONG' ? 'CAPITAL_DEFENSE' : 'RISK_CONTROL',
      focusPool: 'RISK_POOL',
      alertBias: 'RISK_FIRST',
      reviewCadence: strength === 'STRONG' ? 'SLOW' : 'NORMAL',
      title: strength === 'STRONG' ? '当前打法：以防守为主' : '当前打法：风险收缩',
      body: fakeShift
        ? '这次掉回风险区更像回落确认，先把精力放在风险池和降温样本上，别急着把短暂转强当修复。'
        : strength === 'STRONG'
          ? '优先看 Risk Pool 和 R 级/降温迁移，主目标是防追高、防假突破、防把回落误当二次启动。'
          : '先收缩注意力，把观察重点放在风险迁移和降温候选，Prime Pool 只保留最硬的样本。',
      rankingMode: strength === 'STRONG' ? 'RISK_MIGRATION' : 'DEFENSIVE_FILTER',
      alertPolicy: strength === 'STRONG' ? 'DEFENSIVE_RISK' : 'CAUTIOUS_RISK'
    }
  }

  return {
    mode: flips >= 2 ? 'WAIT_CONFIRM' : 'BALANCED_SCAN',
    focusPool: 'EARLY_POOL',
    alertBias: flips >= 2 ? 'CONFIRM_FIRST' : 'B_C_FIRST',
    reviewCadence: flips >= 2 ? 'SLOW' : 'NORMAL',
    title: flips >= 2 ? '当前打法：少动手，多确认' : '当前打法：均衡观察',
    body: flips >= 2
      ? '最近几轮节奏来回切换偏多，先盯 Early Pool 和 B/C 级，等连续确认后再切到更激进打法。'
      : '当前更适合扫 Early Pool 与 B/C 级，先等结构自己走出来，再决定是否切向进攻或防守。',
    rankingMode: flips >= 2 ? 'CONFIRMATION_FIRST' : 'EARLY_DISCOVERY',
    alertPolicy: flips >= 2 ? 'CONFIRM_HEAVY' : 'EARLY_BALANCED'
  }
}

function applyAlertPolicy(candidate, alertStage, lifecycleTransition, playbook, trackedOutcomes = {}, currentRegime = null) {
  const policy = playbook?.alertPolicy ?? 'EARLY_BALANCED'
  const breakout = candidate.score?.acceleration?.breakout === true
  const sustained = safeNumber(candidate.score?.acceleration?.sustainedScans)
  const score = safeNumber(candidate.score?.total)
  const safety = deriveSafetyDecision(candidate).verdict
  const stage = candidate.lifecycle?.stage ?? 'NEW'
  const pool = poolCategory(candidate)

  let nextStage = alertStage
  let transition = lifecycleTransition ? { ...lifecycleTransition } : null
  let blocked = false
  let reason = 'kept_by_policy'
  const feedback = feedbackFromOutcomes(candidate, trackedOutcomes, currentRegime ?? playbook?.regime ?? null)

  if (policy === 'AGGRESSIVE_ACTION') {
    if (nextStage === 'EARLY' && (breakout || sustained >= 1 || score >= 82) && safety !== 'DOWNGRADE') {
      nextStage = 'CONFIRM'
      reason = 'upgraded_to_confirm'
    }
    if (transition && transition.tone === 'ACTION') {
      transition.priority += 10
      transition.severity = transition.severity === 'MEDIUM' ? 'HIGH' : transition.severity
      if (transition.kind === 'LIVE_SMALL') transition.kind = 'LIVE_OK'
    }
  } else if (policy === 'BALANCED_ACTION') {
    if (transition && transition.tone === 'ACTION' && breakout) transition.priority += 6
  } else if (policy === 'DEFENSIVE_RISK') {
    if (nextStage === 'EARLY' && !(breakout && sustained >= 2 && safety === 'PASS')) {
      blocked = true
      reason = 'blocked_early_under_defensive_risk'
    }
    if (transition && transition.tone === 'ACTION') {
      blocked = true
      reason = 'blocked_action_transition_under_defensive_risk'
    }
    if (transition && transition.tone === 'RISK') {
      transition.priority += 12
      transition.severity = 'HIGH'
    }
  } else if (policy === 'CAUTIOUS_RISK') {
    if (nextStage === 'EARLY' && pool !== 'RISK_POOL' && stage !== 'CONFIRMED') {
      blocked = true
      reason = 'blocked_non_risk_early'
    }
    if (transition && transition.tone === 'ACTION' && safety !== 'PASS') {
      blocked = true
      reason = 'blocked_unsafe_action_transition'
    }
    if (transition && transition.tone === 'RISK') transition.priority += 8
  } else if (policy === 'CONFIRM_HEAVY') {
    if (nextStage === 'EARLY' && !(breakout || sustained >= 2 || score >= 84)) {
      blocked = true
      reason = 'blocked_until_confirm'
    }
    if (transition && transition.stage === 'TRANSITION_HEATING' && score < 76) {
      blocked = true
      reason = 'blocked_weak_heating_transition'
    }
    if (transition && transition.stage === 'TRANSITION_CONFIRMED') transition.priority += 8
  } else {
    if (transition && transition.stage === 'TRANSITION_CONFIRMED' && breakout) transition.priority += 4
  }

  if (!blocked && feedback.alertAdjustment > 0) {
    if (nextStage === 'EARLY' && feedback.alertAdjustment >= 8) {
      nextStage = 'CONFIRM'
      reason = 'feedback_promoted'
    }
    if (transition) transition.priority += feedback.alertAdjustment
  }
  if (!blocked && feedback.alertAdjustment < 0) {
    if (nextStage === 'EARLY' && feedback.alertAdjustment <= -10) {
      blocked = true
      nextStage = null
      reason = 'feedback_suppressed'
    }
    if (transition) transition.priority = Math.max(0, safeNumber(transition.priority) + feedback.alertAdjustment)
  }

  return {
    alertStage: blocked ? null : nextStage,
    lifecycleTransition: transition,
    blocked,
    reason,
    feedback: feedback.label,
  }
}

function evaluateTrackedOutcomes(historyState, candidates, scannedAt) {
  const nextTracked = { ...(historyState?.trackedOutcomes ?? {}) }
  const currentByKey = new Map(candidates.map((candidate) => [keyForCandidate(candidate), candidate]))

  for (const [key, item] of Object.entries(nextTracked)) {
    if (item?.resolvedAt) continue
    const candidate = currentByKey.get(key)
    if (!candidate) continue
    const price = safeNumber(candidate.priceUsd)
    const basePrice = safeNumber(item.basePrice)
    if (!basePrice || !price) continue
    const movePct = ((price - basePrice) / basePrice) * 100
    item.lastObservedAt = scannedAt
    item.lastPrice = price
    item.maxUpPct = Math.max(safeNumber(item.maxUpPct, movePct), movePct)
    item.maxDownPct = Math.min(safeNumber(item.maxDownPct, movePct), movePct)
    item.observations = safeNumber(item.observations) + 1

    const trackedMs = new Date(scannedAt).getTime() - new Date(item.createdAt).getTime()
    const doneByTime = trackedMs >= MOONSHOT_LIMITS.feedback.trackOutcomeResolveMs
    const doneByMove = item.maxUpPct >= 12 || item.maxDownPct <= -8
    if (doneByTime || doneByMove) {
      item.resolvedAt = scannedAt
      item.outcome = item.maxUpPct >= MOONSHOT_LIMITS.feedback.winThresholdPct ? 'WIN' : item.maxDownPct <= MOONSHOT_LIMITS.feedback.failThresholdPct ? 'FAIL' : 'MIXED'
    }
  }

  return nextTracked
}

function computeOutcomeBuckets(trackedOutcomes = {}, options = {}) {
  const nowTs = Number.isFinite(new Date(options.now ?? Date.now()).getTime()) ? new Date(options.now ?? Date.now()).getTime() : Date.now()
  const halfLifeMs = MOONSHOT_LIMITS.feedback.outcomeHalfLifeMs
  const resolved = Object.values(trackedOutcomes).filter((item) => item?.resolvedAt)
  const groups = {
    pool: new Map(),
    executionTier: new Map(),
    lifecycleStage: new Map(),
    transitionTone: new Map(),
    tonePool: new Map(),
    regimeTone: new Map(),
    outcome: new Map(),
    combo: new Map(),
    regimeCombo: new Map(),
  }

  const recencyWeightFor = (item) => {
    const resolvedTs = new Date(item?.resolvedAt ?? item?.lastObservedAt ?? item?.createdAt ?? nowTs).getTime()
    if (!Number.isFinite(resolvedTs)) return 1
    const ageMs = Math.max(0, nowTs - resolvedTs)
    return Number((0.5 ** (ageMs / halfLifeMs)).toFixed(4))
  }

  const push = (map, key, item) => {
    if (!key) return
    const bucket = map.get(key) ?? { key, total: 0, weightedTotal: 0, wins: 0, fails: 0, mixes: 0, weightedWins: 0, weightedFails: 0, weightedMixes: 0, avgMaxUpPct: 0, avgMaxDownPct: 0, recencyWeightSum: 0 }
    const weight = recencyWeightFor(item)
    bucket.total += 1
    bucket.weightedTotal += weight
    bucket.recencyWeightSum += weight
    if (item.outcome === 'WIN') {
      bucket.wins += 1
      bucket.weightedWins += weight
    } else if (item.outcome === 'FAIL') {
      bucket.fails += 1
      bucket.weightedFails += weight
    } else {
      bucket.mixes += 1
      bucket.weightedMixes += weight
    }
    bucket.avgMaxUpPct += safeNumber(item.maxUpPct) * weight
    bucket.avgMaxDownPct += safeNumber(item.maxDownPct) * weight
    map.set(key, bucket)
  }

  for (const item of resolved) {
    const comboKey = [item.transitionTone, item.pool, item.lifecycleStage, item.executionTier].filter(Boolean).join(' / ')
    const tonePoolKey = [item.transitionTone, item.pool].filter(Boolean).join(' / ')
    const regimeComboKey = [item.regimeTone, item.transitionTone, item.pool, item.lifecycleStage, item.executionTier].filter(Boolean).join(' / ')
    push(groups.pool, item.pool, item)
    push(groups.executionTier, item.executionTier, item)
    push(groups.lifecycleStage, item.lifecycleStage, item)
    push(groups.transitionTone, item.transitionTone, item)
    push(groups.tonePool, tonePoolKey, item)
    push(groups.regimeTone, item.regimeTone, item)
    push(groups.outcome, item.outcome, item)
    push(groups.combo, comboKey, item)
    push(groups.regimeCombo, regimeComboKey, item)
  }

  const finalize = (map) => [...map.values()]
    .map((bucket) => ({
      ...bucket,
      weightedTotal: Number(bucket.weightedTotal.toFixed(2)),
      winRate: bucket.total ? Number(((bucket.wins / bucket.total) * 100).toFixed(1)) : 0,
      failRate: bucket.total ? Number(((bucket.fails / bucket.total) * 100).toFixed(1)) : 0,
      weightedWinRate: bucket.weightedTotal ? Number(((bucket.weightedWins / bucket.weightedTotal) * 100).toFixed(1)) : 0,
      weightedFailRate: bucket.weightedTotal ? Number(((bucket.weightedFails / bucket.weightedTotal) * 100).toFixed(1)) : 0,
      avgMaxUpPct: bucket.weightedTotal ? Number((bucket.avgMaxUpPct / bucket.weightedTotal).toFixed(2)) : 0,
      avgMaxDownPct: bucket.weightedTotal ? Number((bucket.avgMaxDownPct / bucket.weightedTotal).toFixed(2)) : 0,
      recencyWeightAvg: bucket.total ? Number((bucket.recencyWeightSum / bucket.total).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.weightedWinRate - a.weightedWinRate || b.weightedTotal - a.weightedTotal || b.total - a.total)

  const pool = finalize(groups.pool)
  const executionTier = finalize(groups.executionTier)
  const lifecycleStage = finalize(groups.lifecycleStage)
  const transitionTone = finalize(groups.transitionTone)
  const tonePool = finalize(groups.tonePool)
  const outcome = finalize(groups.outcome)
  const combo = finalize(groups.combo)

  const regimeTone = finalize(groups.regimeTone)
  const regimeCombo = finalize(groups.regimeCombo)

  return {
    pool,
    executionTier,
    lifecycleStage,
    transitionTone,
    tonePool,
    regimeTone,
    outcome,
    combo,
    regimeCombo,
    leaderboard: {
      bestWinRate: combo.filter((item) => item.total >= MOONSHOT_LIMITS.history.leaderboardMinSamples).slice(0, 5),
      bestUpside: [...combo].filter((item) => item.total >= MOONSHOT_LIMITS.history.leaderboardMinSamples).sort((a, b) => b.avgMaxUpPct - a.avgMaxUpPct || b.weightedTotal - a.weightedTotal || b.total - a.total).slice(0, 5),
      worstFailRate: [...combo].filter((item) => item.total >= MOONSHOT_LIMITS.history.leaderboardMinSamples).sort((a, b) => b.weightedFailRate - a.weightedFailRate || b.weightedTotal - a.weightedTotal || b.total - a.total).slice(0, 5),
    },
  }
}

function buildReplaySummary(candidates = [], policyAdjusted = [], regime = null, playbook = null, trackedOutcomes = {}) {
  const total = candidates.length
  const confirmed = candidates.filter((item) => item.lifecycle?.stage === 'CONFIRMED').length
  const heating = candidates.filter((item) => item.lifecycle?.stage === 'HEATING').length
  const cooling = candidates.filter((item) => item.lifecycle?.stage === 'COOLING').length
  const breakoutCount = candidates.filter((item) => item.score?.acceleration?.breakout === true).length
  const avgScoreDelta = total ? candidates.reduce((sum, item) => sum + safeNumber(item.score?.acceleration?.scoreDelta), 0) / total : 0
  const promotedToConfirm = policyAdjusted.filter((item) => item.reason === 'upgraded_to_confirm').length
  const blockedByPolicy = policyAdjusted.filter((item) => item.blocked).length
  const emitted = policyAdjusted.filter((item) => item.stage || item.transition).length
  const tracked = Object.values(trackedOutcomes)
  const resolved = tracked.filter((item) => item?.resolvedAt)
  const wins = resolved.filter((item) => item?.outcome === 'WIN').length
  const fails = resolved.filter((item) => item?.outcome === 'FAIL').length
  const mixes = resolved.filter((item) => item?.outcome === 'MIXED').length
  const buckets = computeOutcomeBuckets(trackedOutcomes)

  let title = '回放归因：结构中性'
  let body = '当前先继续积累样本，重点看升温、确认与降温三类结构如何在后续几轮演化。'
  if ((regime?.tone ?? 'WATCH') === 'ACTION') {
    title = '回放归因：强势样本优先浮现'
    body = `本轮更偏把 breakout / confirmed / Prime Pool 顶上来。当前确认段 ${confirmed} 个，breakout ${breakoutCount} 个，适合盯后续是否继续扩散。`
  } else if ((regime?.tone ?? 'WATCH') === 'RISK') {
    title = '回放归因：风险迁移优先浮现'
    body = `本轮更偏把 cooling / risk pool / 安全性偏弱样本提到前面。当前降温段 ${cooling} 个，被 policy 压掉 ${blockedByPolicy} 个进攻噪音。`
  } else if ((playbook?.alertPolicy ?? 'EARLY_BALANCED') === 'CONFIRM_HEAVY') {
    title = '回放归因：确认优先'
    body = `当前更重连续确认而不是早期异动。升温段 ${heating} 个，但被延后/压掉 ${blockedByPolicy} 个偏早提醒，减少摇摆阶段噪音。`
  }

  return {
    title,
    body,
    metrics: {
      total,
      confirmed,
      heating,
      cooling,
      breakoutCount,
      avgScoreDelta: Number(avgScoreDelta.toFixed(2)),
      promotedToConfirm,
      blockedByPolicy,
      emitted,
      tracked: tracked.length,
      resolved: resolved.length,
      wins,
      fails,
      mixes,
    },
    buckets,
    feedbackHealth: {
      positiveCombos: buckets.combo.filter((item) => item.weightedWinRate >= 60 && item.weightedFailRate <= 25 && item.total >= 2).length,
      negativeCombos: buckets.combo.filter((item) => item.weightedFailRate >= 60 && item.total >= 2).length,
      reversalCombos: buckets.combo.filter((item) => item.weightedFailRate >= 50 && item.recencyWeightAvg >= 0.55 && item.total >= 2).length,
    },
  }
}

function candidateComboKey(candidate) {
  return [candidate.lifecycle?.transitionTone ?? 'WATCH', poolCategory(candidate), candidate.lifecycle?.stage ?? 'NEW', candidate.lifecycle?.executionTier ?? 'R']
    .filter(Boolean)
    .join(' / ')
}

function feedbackFromOutcomes(candidate, trackedOutcomes = {}, currentRegime = null) {
  const buckets = computeOutcomeBuckets(trackedOutcomes)
  const comboKey = candidateComboKey(candidate)
  const tonePoolKey = [candidate.lifecycle?.transitionTone ?? 'WATCH', poolCategory(candidate)].filter(Boolean).join(' / ')
  const toneKey = candidate.lifecycle?.transitionTone ?? 'WATCH'
  const poolKey = poolCategory(candidate)
  const tierKey = candidate.lifecycle?.executionTier ?? 'R'
  const regimeTone = currentRegime?.tone ?? null
  const regimeComboKey = [regimeTone, comboKey].filter(Boolean).join(' / ')

  const exactCombo = buckets.combo?.find((item) => item.key === comboKey) ?? null
  const regimeCombo = buckets.regimeCombo?.find((item) => item.key === regimeComboKey) ?? null
  const tonePoolBucket = buckets.tonePool?.find((item) => item.key === tonePoolKey) ?? null
  const toneBucket = buckets.transitionTone?.find((item) => item.key === toneKey) ?? null
  const poolBucket = buckets.pool?.find((item) => item.key === poolKey) ?? null
  const tierBucket = buckets.executionTier?.find((item) => item.key === tierKey) ?? null

  const candidates = [
    { bucket: regimeCombo, mode: 'REGIME_MATCHED', minTotal: MOONSHOT_LIMITS.feedback.minComboSamples, fallbackPenalty: 1 },
    { bucket: exactCombo, mode: regimeTone ? 'REGIME_FALLBACK' : 'GLOBAL_FALLBACK', minTotal: MOONSHOT_LIMITS.feedback.minComboSamples, fallbackPenalty: 0.88 },
    { bucket: tonePoolBucket, mode: 'TONE_POOL_FALLBACK', minTotal: MOONSHOT_LIMITS.feedback.tonePoolMinSamples, fallbackPenalty: 0.76 },
    { bucket: toneBucket, mode: 'TONE_FALLBACK', minTotal: MOONSHOT_LIMITS.feedback.broadFallbackMinSamples, fallbackPenalty: 0.68 },
    { bucket: poolBucket, mode: 'POOL_FALLBACK', minTotal: MOONSHOT_LIMITS.feedback.broadFallbackMinSamples, fallbackPenalty: 0.62 },
    { bucket: tierBucket, mode: 'TIER_FALLBACK', minTotal: MOONSHOT_LIMITS.feedback.broadFallbackMinSamples, fallbackPenalty: 0.58 },
  ]
  const selected = candidates.find((entry) => entry.bucket?.total >= entry.minTotal) ?? null
  const combo = selected?.bucket ?? null

  if (!combo) {
    return { rankingAdjustment: 0, alertAdjustment: 0, label: 'NO_SIGNAL', comboKey, regimeComboKey, combo, confidence: 0, confidenceLabel: 'LOW', decayWeight: null, calibrationMode: 'INSUFFICIENT_SAMPLE', regimeAligned: false, fallbackDepth: 0, recentFailRate: null, reversalActive: false }
  }

  const weightedSample = safeNumber(combo.weightedTotal)
  const sampleConfidence = clamp(weightedSample / 4, 0, 1)
  const regimeAligned = selected?.mode === 'REGIME_MATCHED'
  const decayWeight = safeNumber(combo.recencyWeightAvg, 0.5)
  const fallbackPenalty = safeNumber(selected?.fallbackPenalty, 0.5)
  const confidence = Number(clamp(sampleConfidence * fallbackPenalty * clamp(decayWeight * 1.35, 0.35, 1), 0, 1).toFixed(2))
  const confidenceLabel = confidence >= 0.75 ? 'HIGH' : confidence >= 0.45 ? 'MEDIUM' : 'LOW'
  const weightedWinRate = safeNumber(combo.weightedWinRate)
  const weightedFailRate = safeNumber(combo.weightedFailRate)
  const recentResolved = Object.values(trackedOutcomes)
    .filter((item) => item?.resolvedAt)
    .filter((item) => [item.transitionTone, item.pool, item.lifecycleStage, item.executionTier].filter(Boolean).join(' / ') === comboKey)
    .sort((a, b) => new Date(b?.resolvedAt ?? 0).getTime() - new Date(a?.resolvedAt ?? 0).getTime())
    .slice(0, MOONSHOT_LIMITS.feedback.recentWindow)
  const recentFailRate = recentResolved.length ? Number(((recentResolved.filter((item) => item?.outcome === 'FAIL').length / recentResolved.length) * 100).toFixed(1)) : null
  const reversalActive = recentResolved.length >= MOONSHOT_LIMITS.feedback.reversalMinFails && recentResolved.filter((item) => item?.outcome === 'FAIL').length >= MOONSHOT_LIMITS.feedback.reversalMinFails
  const reversalPenalty = reversalActive ? 0.55 : recentFailRate != null && recentFailRate >= 66 ? 0.75 : 1
  const rankingScale = Number((confidence * reversalPenalty).toFixed(2))
  const alertScale = rankingScale >= MOONSHOT_LIMITS.feedback.minConfidenceForAlert && (selected?.mode === 'REGIME_MATCHED' || selected?.mode === 'REGIME_FALLBACK' || selected?.mode === 'GLOBAL_FALLBACK') ? rankingScale : 0

  let rankingAdjustment = 0
  let alertAdjustment = 0
  let label = 'NEUTRAL_EDGE'

  if (weightedWinRate >= 60 && weightedFailRate <= 25) {
    rankingAdjustment = Math.round(120 * rankingScale)
    alertAdjustment = Math.round(8 * alertScale)
    label = rankingScale >= 0.35 ? 'POSITIVE_EDGE' : 'NEUTRAL_EDGE'
  } else if (weightedFailRate >= 60 || reversalActive) {
    rankingAdjustment = Math.round(-140 * Math.max(rankingScale, reversalActive ? 0.45 : 0))
    alertAdjustment = Math.round(-10 * Math.max(alertScale, reversalActive ? 0.45 : 0))
    label = Math.max(rankingScale, reversalActive ? 0.45 : 0) >= 0.35 ? 'NEGATIVE_EDGE' : 'NEUTRAL_EDGE'
  } else if (combo.avgMaxUpPct >= 8 && weightedFailRate < 40) {
    rankingAdjustment = Math.round(80 * rankingScale)
    alertAdjustment = Math.round(4 * alertScale)
    label = rankingScale >= 0.35 ? 'UPSIDE_EDGE' : 'NEUTRAL_EDGE'
  }

  if (reversalActive && label === 'POSITIVE_EDGE') {
    label = 'NEUTRAL_EDGE'
  }

  rankingAdjustment = clamp(rankingAdjustment, -MOONSHOT_LIMITS.feedback.maxRankingAdjustment, MOONSHOT_LIMITS.feedback.maxRankingAdjustment)
  alertAdjustment = clamp(alertAdjustment, -MOONSHOT_LIMITS.feedback.maxAlertAdjustment, MOONSHOT_LIMITS.feedback.maxAlertAdjustment)

  return {
    rankingAdjustment,
    alertAdjustment,
    label,
    comboKey,
    regimeComboKey,
    combo,
    confidence,
    confidenceLabel,
    decayWeight: Number(decayWeight.toFixed(2)),
    calibrationMode: selected?.mode ?? 'GLOBAL_FALLBACK',
    regimeAligned,
    fallbackDepth: candidates.findIndex((entry) => entry.mode === selected?.mode) + 1,
    recentFailRate,
    reversalActive,
  }
}

function regimeRankingBonus(candidate, playbook, trackedOutcomes = {}, currentRegime = null) {
  const mode = playbook?.rankingMode ?? 'EARLY_DISCOVERY'
  const pool = poolCategory(candidate)
  const tone = candidate.lifecycle?.transitionTone ?? 'WATCH'
  const stage = candidate.lifecycle?.stage ?? 'NEW'
  const executionTier = candidate.lifecycle?.executionTier ?? 'R'
  const safety = deriveSafetyDecision(candidate).verdict
  const breakout = candidate.score?.acceleration?.breakout === true
  const sustained = safeNumber(candidate.score?.acceleration?.sustainedScans)
  const scoreDelta = safeNumber(candidate.score?.acceleration?.scoreDelta)
  const priority = safeNumber(candidate.lifecycle?.transitionPriority)

  let bonus = 0

  if (mode === 'BREAKOUT_MOMENTUM') {
    if (pool === 'PRIME_POOL') bonus += 260
    if (executionTier === 'A') bonus += 180
    if (executionTier === 'B') bonus += 120
    if (breakout) bonus += 150
    if (sustained >= 2) bonus += 90
    if (tone === 'ACTION') bonus += 100
    if (stage === 'CONFIRMED') bonus += 90
    if (safety === 'PASS') bonus += 80
  } else if (mode === 'QUALITY_MOMENTUM') {
    if (pool === 'PRIME_POOL') bonus += 220
    if (pool === 'EARLY_POOL') bonus += 80
    if (executionTier === 'A') bonus += 130
    if (executionTier === 'B') bonus += 100
    if (safety === 'PASS') bonus += 100
    if (scoreDelta >= 4) bonus += 70
    if (tone === 'ACTION') bonus += 80
  } else if (mode === 'RISK_MIGRATION') {
    if (pool === 'RISK_POOL') bonus += 260
    if (stage === 'COOLING') bonus += 140
    if (tone === 'RISK') bonus += 120
    if (executionTier === 'R') bonus += 110
    if (safety !== 'PASS') bonus += 90
    if (priority >= 80) bonus += 70
  } else if (mode === 'DEFENSIVE_FILTER') {
    if (pool === 'RISK_POOL') bonus += 180
    if (stage === 'COOLING') bonus += 120
    if (tone === 'RISK') bonus += 90
    if (safety === 'DOWNGRADE' || safety === 'BLOCK') bonus += 80
    if (pool === 'PRIME_POOL') bonus -= 120
  } else if (mode === 'CONFIRMATION_FIRST') {
    if (stage === 'CONFIRMED') bonus += 160
    if (sustained >= 2) bonus += 110
    if (breakout) bonus += 80
    if (executionTier === 'B') bonus += 90
    if (executionTier === 'C') bonus += 70
    if (pool === 'EARLY_POOL') bonus += 100
    if (scoreDelta < 2) bonus -= 40
  } else {
    if (pool === 'EARLY_POOL') bonus += 140
    if (stage === 'HEATING') bonus += 100
    if (executionTier === 'B') bonus += 80
    if (executionTier === 'C') bonus += 70
    if (scoreDelta >= 4) bonus += 60
    if (tone === 'WATCH') bonus += 50
  }

  const feedback = feedbackFromOutcomes(candidate, trackedOutcomes, currentRegime ?? playbook?.regime ?? null)
  return bonus + feedback.rankingAdjustment
}

function candidatePriorityScore(candidate, playbook = null, trackedOutcomes = {}, currentRegime = null) {
  const toneWeight = candidate.lifecycle?.transitionTone === 'ACTION' ? 1000 : candidate.lifecycle?.transitionTone === 'WATCH' ? 600 : 150
  const safetyWeight = safetyPriority(deriveSafetyDecision(candidate).verdict) * 120
  const poolWeight = poolCategory(candidate) === 'PRIME_POOL' ? 220 : poolCategory(candidate) === 'EARLY_POOL' ? 120 : poolCategory(candidate) === 'RISK_POOL' ? -50 : 0
  return toneWeight
    + safetyWeight
    + poolWeight
    + regimeRankingBonus(candidate, playbook, trackedOutcomes, currentRegime)
    + (candidate.lifecycle?.transitionPriority ?? 0) * 4
    + lifecyclePriority(candidate.lifecycle?.stage) * 20
    + (candidate.raveLike?.total ?? 0) * 2
    + (candidate.score?.total ?? 0)
}

function buildAlert(candidate, stage = 'EARLY', options = {}) {
  const metrics = candidate.score.metrics
  const accel = candidate.score.acceleration
  const safetyDecision = deriveSafetyDecision(candidate)
  const level = effectiveLevel(candidate)
  const isExtreme = level === 'EXTREME'
  const riskFlags = candidate.riskFlags ?? []
  const raveLike = candidate.raveLike ?? { total: 0, label: 'WEAK', reasons: [] }
  const safety = candidate.safety ?? { provider: 'n/a', safeToWatch: false, checks: [] }
  const alertKind = options.kind ?? (isExtreme || stage === 'CONFIRM' ? 'LIVE_OK' : 'LIVE_SMALL')
  const severity = options.severity ?? (isExtreme || stage === 'CONFIRM' ? 'HIGH' : 'MEDIUM')
  const titlePrefix = options.titlePrefix ?? '暴涨雷达'
  const explanation = options.explanation ?? (
    stage === 'CONFIRM'
      ? '说明：这是二段确认提醒，说明它在初次异动后又继续增强，更值得你立刻复核。'
      : isExtreme
        ? '说明：这类通常不是单点拉升，而是“量、活跃度、评分同步升级”的候选，优先人工复核是否仍在发酵。'
        : '说明：这是早期 HOT 候选，优先看后续几轮扫描是否继续加速、是否升级成 EXTREME。'
  )
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: alertKind,
    title: `[${titlePrefix} / ${level} / ${stage}] ${candidate.symbol} (${candidate.chainId})`,
    body: [
      `${candidate.symbol} / ${candidate.name}`,
      '',
      `链：${candidate.chainId}`,
      `DEX：${candidate.dexId}`,
      `价格：$${safeNumber(candidate.priceUsd).toFixed(6)}`,
      `Moon Score：${candidate.score.total}`,
      `1h / 6h / 24h：${metrics.changeH1.toFixed(2)}% / ${metrics.changeH6.toFixed(2)}% / ${metrics.changeH24.toFixed(2)}%`,
      `5m / 1h / 24h 成交额：$${Math.round(metrics.volumeM5).toLocaleString()} / $${Math.round(metrics.volumeH1).toLocaleString()} / $${Math.round(metrics.volumeH24).toLocaleString()}`,
      `5m / 1h 交易数：${Math.round(metrics.txnsM5)} / ${Math.round(metrics.txnsH1)}`,
      `流动性：$${Math.round(metrics.liquidityUsd).toLocaleString()}`,
      `Acceleration：scoreΔ ${accel.scoreDelta >= 0 ? '+' : ''}${accel.scoreDelta} · volume ${accel.volumeH1Ratio.toFixed(2)}x · txns ${accel.txnsH1Ratio.toFixed(2)}x`,
      `Breakout：${accel.breakout ? 'YES' : 'NO'} · Sustained HOT scans：${accel.sustainedScans}`,
      `提醒阶段：${stage}`,
      `有效级别：${level}`,
      `生命周期：${candidate.lifecycle?.stage ?? 'NEW'} / ${candidate.lifecycle?.reason ?? '初始阶段'}`,
      `状态迁移：${candidate.lifecycle?.transitionLabel ?? 'INIT → NEW'}${candidate.lifecycle?.changed ? '（本轮发生变化）' : ''}`,
      `执行等级：${candidate.lifecycle?.executionTier ?? buildExecutionTier(candidate)}`,
      `决策短句：${options.decisionLine ?? candidate.lifecycle?.decisionLine ?? buildDecisionLine(candidate)}`,
      `时机建议：${candidate.lifecycle?.timingHint ?? buildTimingHint(candidate)}`,
      `RAVE-like：${raveLike.label} / ${raveLike.total}`,
      `Safety：${safety.safeToWatch ? 'WATCHABLE' : 'CAUTION'} / ${safety.provider}`,
      `Safety verdict：${safetyDecision.verdict} / ${safetyDecision.reason}`,
      `Safety meta：configured=${safety.meta?.configured ? 'YES' : 'NO'} · implemented=${safety.meta?.implemented ? 'YES' : 'NO'}`,
      `FDV：$${Math.round(safeNumber(candidate.fdv)).toLocaleString()}`,
      `Age：${metrics.ageHours == null ? '-' : `${metrics.ageHours.toFixed(1)}h`}`,
      `触发因子：${candidate.score.reasons.join('，') || '综合异动触发'}`,
      `RAVE-like 因子：${raveLike.reasons?.join('，') || '暂无'}`,
      `风险标签：${riskFlags.length ? riskFlags.join('，') : '未见明显结构性风险标签'}`,
      `链接：${candidate.url}`,
      '',
      explanation
    ].join('\n'),
    signature: `moonshot:${candidate.chainId}:${candidate.tokenAddress}:${level}:${stage}:${candidate.lifecycle?.transitionLabel ?? 'none'}:${safetyDecision.verdict}:${accel.breakout ? 'breakout' : 'normal'}`,
    severity,
    status: 'PENDING',
  }
}

function buildTransitionAlert(candidate, transitionMeta) {
  if (!transitionMeta) return null
  const transitionLabel = candidate.lifecycle?.transitionLabel ?? 'UNKNOWN'
  const explanation = transitionMeta.stage === 'TRANSITION_HEATING'
    ? `说明：它刚从 NEW 进入 HEATING。${transitionMeta.reason ?? '开始进入加热阶段。'}`
    : transitionMeta.stage === 'TRANSITION_CONFIRMED'
      ? `说明：它刚从 HEATING 进入 CONFIRMED。${transitionMeta.reason ?? '这类比单纯高分更值得优先复核。'}`
      : `说明：它刚从 CONFIRMED 进入 COOLING。${transitionMeta.reason ?? '重点是评估是否开始失去追踪价值、避免追末端。'}`
  return buildAlert(candidate, transitionMeta.stage, {
    kind: transitionMeta.kind,
    severity: transitionMeta.severity,
    titlePrefix: `状态迁移雷达 / ${transitionMeta.tone ?? 'WATCH'} / P${transitionMeta.priority ?? 0}`,
    explanation,
    decisionLine: buildDecisionLine(candidate, transitionMeta),
  })
}

function compactSnapshot(candidate, scannedAt) {
  return {
    scannedAt,
    scoreTotal: candidate.score.total,
    level: candidate.score.level,
    lifecycleStage: candidate.lifecycle?.stage ?? null,
    stageSinceAt: candidate.lifecycle?.stageSinceAt ?? scannedAt,
    transitionTone: candidate.lifecycle?.transitionTone ?? null,
    transitionPriority: candidate.lifecycle?.transitionPriority ?? 0,
    transitionReason: candidate.lifecycle?.transitionReason ?? null,
    decisionLine: candidate.lifecycle?.decisionLine ?? null,
    timingHint: candidate.lifecycle?.timingHint ?? null,
    executionTier: candidate.lifecycle?.executionTier ?? null,
    safetyVerdict: candidate.safety?.verdict ?? null,
    metrics: candidate.score.metrics,
  }
}

function updateHistory(candidates, scannedAt, existingHistory) {
  const next = {
    snapshots: { ...(existingHistory?.snapshots ?? {}) },
    lastAlerts: { ...(existingHistory?.lastAlerts ?? {}) },
    cooldowns: { ...(existingHistory?.cooldowns ?? {}) },
    regimeSnapshots: [...(existingHistory?.regimeSnapshots ?? [])],
    trackedOutcomes: { ...(existingHistory?.trackedOutcomes ?? {}) },
  }
  for (const candidate of candidates) {
    const key = keyForCandidate(candidate)
    const series = [...(next.snapshots[key] ?? []), compactSnapshot(candidate, scannedAt)].slice(-MOONSHOT_LIMITS.history.snapshotSeries)
    next.snapshots[key] = series

    if (!next.trackedOutcomes[key]) {
      next.trackedOutcomes[key] = {
        key,
        createdAt: scannedAt,
        basePrice: safeNumber(candidate.priceUsd),
        symbol: candidate.symbol,
        chainId: candidate.chainId,
        lifecycleStage: candidate.lifecycle?.stage ?? 'NEW',
        executionTier: candidate.lifecycle?.executionTier ?? 'R',
        transitionTone: candidate.lifecycle?.transitionTone ?? 'WATCH',
        pool: poolCategory(candidate),
        regimeTone: null,
        maxUpPct: 0,
        maxDownPct: 0,
        observations: 0,
        outcome: null,
        resolvedAt: null,
      }
    }

    const cooldown = next.cooldowns[key] ?? null
    if ((candidate.score.level === 'WATCH' || candidate.score.total < 64) && cooldown?.until) {
      next.cooldowns[key] = { ...cooldown, rearmed: true, cooledAt: scannedAt }
    }
    if (candidate.score.level === 'EXTREME' && cooldown?.rearmed) {
      next.cooldowns[key] = { ...cooldown, rearmed: false }
    }
  }
  const activeKeys = new Set(candidates.map(keyForCandidate))
  for (const [key, series] of Object.entries(next.snapshots)) {
    if (!activeKeys.has(key)) next.snapshots[key] = series.slice(-MOONSHOT_LIMITS.history.inactiveSnapshotSeries)
  }
  return next
}

export async function scanMoonshotCandidates(options = {}) {
  const historyState = options.historyState ?? readHistory()
  const maxSeed = options.maxSeed ?? 30
  const maxCandidates = options.maxCandidates ?? 12
  const scannedAt = new Date().toISOString()
  const sourceFailures = { boostsLatest: false, boostsTop: false, profiles: false, pairs: 0 }
  const [latestBoosts, topBoosts, profiles] = await Promise.all([
    fetchJson(`${DEX_BASE}/token-boosts/latest/v1`).catch(() => {
      sourceFailures.boostsLatest = true
      return []
    }),
    fetchJson(`${DEX_BASE}/token-boosts/top/v1`).catch(() => {
      sourceFailures.boostsTop = true
      return []
    }),
    fetchJson(`${DEX_BASE}/token-profiles/latest/v1`).catch(() => {
      sourceFailures.profiles = true
      return []
    }),
  ])

  const boostMap = new Map()
  for (const item of [...topBoosts, ...latestBoosts]) {
    const key = `${item.chainId}:${String(item.tokenAddress).toLowerCase()}`
    if (!boostMap.has(key) || safeNumber(item.totalAmount) > safeNumber(boostMap.get(key)?.totalAmount)) {
      boostMap.set(key, item)
    }
  }
  const profileMap = new Map((profiles ?? []).map((item) => [`${item.chainId}:${String(item.tokenAddress).toLowerCase()}`, item]))
  const seedKeys = [...new Set([
    ...[...boostMap.keys()],
    ...[...profileMap.keys()].slice(0, maxSeed),
  ])].slice(0, maxSeed)

  if (!seedKeys.length) {
    return {
      scannedAt,
      sources: {
        boostsLatest: Array.isArray(latestBoosts) ? latestBoosts.length : 0,
        boostsTop: Array.isArray(topBoosts) ? topBoosts.length : 0,
        profiles: Array.isArray(profiles) ? profiles.length : 0,
        seedCount: 0,
        sourceFailures,
      },
      candidates: [],
      historyState,
    }
  }

  const rawPairs = await Promise.all(seedKeys.map(async (key) => {
    const [chainId, tokenAddress] = key.split(':')
    try {
      const data = await fetchJson(`${DEX_BASE}/latest/dex/tokens/${tokenAddress}`)
      const pairs = (data?.pairs ?? []).filter((pair) => pair?.chainId === chainId)
        .filter((pair) => safeNumber(pair?.liquidity?.usd) >= 10000)
        .filter((pair) => safeNumber(pair?.volume?.h24) >= 25000)
      if (!pairs.length) return null
      const bestPair = [...pairs].sort((a, b) => {
        const liqDiff = safeNumber(b?.liquidity?.usd) - safeNumber(a?.liquidity?.usd)
        if (liqDiff !== 0) return liqDiff
        return safeNumber(b?.volume?.h24) - safeNumber(a?.volume?.h24)
      })[0]
      return {
        pair: bestPair,
        boost: boostMap.get(key) ?? null,
        profile: profileMap.get(key) ?? null,
      }
    } catch {
      sourceFailures.pairs += 1
      return null
    }
  }))

  const preparedCandidates = (await Promise.all(rawPairs
    .filter(Boolean)
    .map(async ({ pair, boost, profile }) => {
      const history = historyState.snapshots[`${pair.chainId}:${String(pair.baseToken?.address).toLowerCase()}`] ?? []
      const score = scoreCandidate(pair, boost, profile, history)
      const safety = await runSafetyChecks(pair).catch(() => ({ provider: 'local-heuristic', safeToWatch: false, checks: [{ key: 'safety_fallback', passed: false, message: 'safety check failed' }], meta: { configured: true, implemented: false } }))
      const raveLike = computeRaveLikeProfile(pair, score)
      const baseCandidate = {
        chainId: pair.chainId,
        dexId: pair.dexId,
        pairAddress: pair.pairAddress,
        tokenAddress: pair.baseToken?.address,
        symbol: pair.baseToken?.symbol,
        name: pair.baseToken?.name,
        quoteSymbol: pair.quoteToken?.symbol,
        priceUsd: safeNumber(pair.priceUsd),
        liquidityUsd: safeNumber(pair?.liquidity?.usd),
        fdv: safeNumber(pair?.fdv),
        marketCap: safeNumber(pair?.marketCap),
        url: pair.url,
        pairCreatedAt: pair.pairCreatedAt ?? null,
        boost: boost ? { amount: safeNumber(boost.totalAmount ?? boost.amount) } : null,
        links: uniqueLinks(profile, boost),
        riskFlags: riskFlagsForPair(pair, score),
        safety,
        raveLike,
        score,
        scannedAt,
      }
      const safetyDecision = deriveSafetyDecision(baseCandidate)
      const lifecycle = deriveLifecycleStage(baseCandidate, historyState)
      const transitionMeta = classifyLifecycleTransitionAlert({ ...baseCandidate, lifecycle, safety: { ...safety, verdict: safetyDecision.verdict, reason: safetyDecision.reason } }, historyState)
      const lifecycleWithTone = {
        ...lifecycle,
        transitionPriority: transitionMeta?.priority ?? 0,
        transitionTone: transitionMeta?.tone ?? (lifecycle.stage === 'COOLING' ? 'RISK' : lifecycle.stage === 'CONFIRMED' ? 'ACTION' : 'WATCH'),
        transitionReason: transitionMeta?.reason ?? lifecycle.reason,
      }
      const candidate = {
        ...baseCandidate,
        lifecycle: {
          ...lifecycleWithTone,
          decisionLine: buildDecisionLine({ ...baseCandidate, lifecycle: lifecycleWithTone }, transitionMeta),
          timingHint: buildTimingHint({ ...baseCandidate, lifecycle: lifecycleWithTone }, transitionMeta),
          executionTier: buildExecutionTier({ ...baseCandidate, lifecycle: lifecycleWithTone }, transitionMeta),
        },
        safety: {
          ...safety,
          verdict: safetyDecision.verdict,
          reason: safetyDecision.reason,
        },
      }
      return candidate
    })))
    .filter((item) => shouldKeepCandidate(item))

  const previewRegime = summarizeMarketRegime(preparedCandidates)
  const previousRegime = (historyState.regimeSnapshots ?? []).slice(-1)[0] ?? null
  const previewShift = computeRegimeShift(previewRegime, previousRegime, historyState.regimeSnapshots ?? [])
  const previewPlaybook = { ...buildRegimePlaybook(previewRegime, previewShift), regime: previewRegime }
  const calibratedCandidates = preparedCandidates.map((candidate) => {
    const feedback = feedbackFromOutcomes(candidate, historyState.trackedOutcomes ?? {}, previewRegime)
    const copyPolicy = buildFeedbackCopyPolicy(candidate, feedback)
    return {
      ...candidate,
      lifecycle: {
        ...candidate.lifecycle,
        decisionLine: `${copyPolicy.decisionPrefix}${candidate.lifecycle?.decisionLine ?? '先观察：暂无明确决策短句'}`,
        timingHint: copyPolicy.timing ?? candidate.lifecycle?.timingHint,
      },
      feedback: {
        label: feedback.label,
        comboKey: feedback.comboKey,
        regimeComboKey: feedback.regimeComboKey,
        rankingAdjustment: feedback.rankingAdjustment,
        alertAdjustment: feedback.alertAdjustment,
        sampleSize: feedback.combo?.total ?? 0,
        weightedSampleSize: feedback.combo?.weightedTotal ?? 0,
        winRate: feedback.combo?.winRate ?? null,
        failRate: feedback.combo?.failRate ?? null,
        weightedWinRate: feedback.combo?.weightedWinRate ?? null,
        weightedFailRate: feedback.combo?.weightedFailRate ?? null,
        confidence: feedback.confidence ?? 0,
        confidenceLabel: feedback.confidenceLabel,
        decayWeight: feedback.decayWeight ?? null,
        calibrationMode: feedback.calibrationMode,
        regimeAligned: feedback.regimeAligned ?? false,
        fallbackDepth: feedback.fallbackDepth ?? 0,
        recentFailRate: feedback.recentFailRate ?? null,
        reversalActive: feedback.reversalActive ?? false,
        copyPosture: copyPolicy.posture,
        copyNote: copyPolicy.note,
      },
    }
  })

  const candidates = calibratedCandidates
    .sort((a, b) => {
      const safetyA = safetyPriority(deriveSafetyDecision(a).verdict)
      const safetyB = safetyPriority(deriveSafetyDecision(b).verdict)
      const lifecycleA = lifecyclePriority(a.lifecycle?.stage)
      const lifecycleB = lifecyclePriority(b.lifecycle?.stage)
      const transitionA = a.lifecycle?.changed ? 1 : 0
      const transitionB = b.lifecycle?.changed ? 1 : 0
      return candidatePriorityScore(b, previewPlaybook, historyState.trackedOutcomes ?? {}, previewRegime) - candidatePriorityScore(a, previewPlaybook, historyState.trackedOutcomes ?? {}, previewRegime)
        || safetyB - safetyA
        || (b.lifecycle?.transitionPriority ?? 0) - (a.lifecycle?.transitionPriority ?? 0)
        || lifecycleB - lifecycleA
        || transitionB - transitionA
        || (b.raveLike?.total ?? 0) - (a.raveLike?.total ?? 0)
        || b.score.total - a.score.total
        || b.liquidityUsd - a.liquidityUsd
    })
    .slice(0, maxCandidates)

  return {
    scannedAt,
    sources: {
      boostsLatest: Array.isArray(latestBoosts) ? latestBoosts.length : 0,
      boostsTop: Array.isArray(topBoosts) ? topBoosts.length : 0,
      profiles: Array.isArray(profiles) ? profiles.length : 0,
      seedCount: seedKeys.length,
      sourceFailures,
    },
    candidates,
    historyState,
  }
}

export async function buildMoonshotRuntimeState() {
  const historyState = readHistory()
  const result = await scanMoonshotCandidates({ historyState })
  const regime = summarizeMarketRegime(result.candidates)
  const previousRegime = (historyState.regimeSnapshots ?? []).slice(-1)[0] ?? null
  const regimeShift = computeRegimeShift(regime, previousRegime, historyState.regimeSnapshots ?? [])
  const regimePlaybook = { ...buildRegimePlaybook(regime, regimeShift), regime }

  const policyAdjusted = result.candidates.map((candidate) => {
    const transition = classifyLifecycleTransitionAlert(candidate, historyState)
    const stage = (candidate.score.level === 'HOT' || candidate.score.level === 'EXTREME')
      ? classifyAlertStage(candidate, historyState)
      : null
    const adjusted = applyAlertPolicy(candidate, stage, transition, regimePlaybook, historyState.trackedOutcomes ?? {}, regime)
    return {
      candidate,
      transition: adjusted.lifecycleTransition,
      stage: adjusted.alertStage,
      blocked: adjusted.blocked,
    }
  })

  const transitionAlerts = policyAdjusted
    .filter((item) => item.transition)
    .sort((a, b) => (b.transition?.priority ?? 0) - (a.transition?.priority ?? 0))
    .slice(0, MOONSHOT_LIMITS.alerts.maxTransitionAlerts)
    .map((item) => buildTransitionAlert(item.candidate, item.transition))
    .filter(Boolean)

  const stageAlerts = policyAdjusted
    .filter((item) => item.stage)
    .slice(0, MOONSHOT_LIMITS.alerts.maxStageAlerts)
    .map((item) => buildAlert(item.candidate, item.stage))
    .filter(Boolean)

  const seenAlertKeys = new Set()
  const alerts = [...transitionAlerts, ...stageAlerts]
    .filter((alert) => {
      const key = String(alert?.signature ?? alert?.id ?? '')
      if (!key || seenAlertKeys.has(key)) return false
      seenAlertKeys.add(key)
      return true
    })
    .slice(0, MOONSHOT_LIMITS.alerts.maxPerScan)
  const replay = buildReplaySummary(result.candidates, policyAdjusted, regime, regimePlaybook, historyState.trackedOutcomes ?? {})

  const nextHistory = updateHistory(result.candidates, result.scannedAt, historyState)
  nextHistory.regimeSnapshots = [...(nextHistory.regimeSnapshots ?? []), {
    scannedAt: result.scannedAt,
    tone: regime.tone,
    title: regime.title,
    body: regime.body,
    metrics: regime.metrics,
  }].slice(-MOONSHOT_LIMITS.history.regimeSnapshots)
  for (const candidate of result.candidates) {
    const tracked = nextHistory.trackedOutcomes?.[keyForCandidate(candidate)]
    if (tracked && !tracked.regimeTone) tracked.regimeTone = regime.tone
  }
  nextHistory.trackedOutcomes = evaluateTrackedOutcomes(nextHistory, result.candidates, result.scannedAt)
  for (const item of policyAdjusted) {
    const { candidate, stage, transition } = item
    if (!stage && !transition) continue
    const key = keyForCandidate(candidate)
    const level = effectiveLevel(candidate)
    nextHistory.lastAlerts[key] = {
      level,
      total: candidate.score.total,
      stage: transition?.stage ?? stage,
      transitionLabel: candidate.lifecycle?.transitionLabel ?? null,
      lifecycleStage: candidate.lifecycle?.stage ?? null,
      transitionPriority: candidate.lifecycle?.transitionPriority ?? 0,
      transitionTone: candidate.lifecycle?.transitionTone ?? null,
      scannedAt: result.scannedAt,
    }
    nextHistory.cooldowns[key] = {
      until: new Date(new Date(result.scannedAt).getTime() + cooldownMsForLevel(level)).toISOString(),
      level,
      stage: transition?.stage ?? stage,
      transitionLabel: candidate.lifecycle?.transitionLabel ?? null,
      rearmed: false,
      setAt: result.scannedAt,
    }
  }
  writeHistory(nextHistory)

  return {
    scannedAt: result.scannedAt,
    sources: result.sources,
    candidates: result.candidates,
    alerts,
    regime: {
      ...regime,
      shift: regimeShift,
      playbook: regimePlaybook,
      previousTone: previousRegime?.tone ?? null,
      previousScannedAt: previousRegime?.scannedAt ?? null,
    },
    replay,
    historySummary: {
      tracked: Object.keys(nextHistory.snapshots).length,
      cooldowns: Object.keys(nextHistory.cooldowns ?? {}).length,
      lastHistoryWriteAt: result.scannedAt,
      file: MOONSHOT_HISTORY_FILE,
      sourceFailures: result.sources?.sourceFailures ?? null,
      alertCount: alerts.length,
      candidateCount: result.candidates.length,
    }
  }
}
