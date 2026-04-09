import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { emitAlertsFromSnapshot } from './alert-runtime.mjs'
import { buildServerExecutionLayer } from './gate-runtime.mjs'
import { createFeishuWebhookNotifier } from './notifier-feishu.mjs'
import { readReadinessState, updateReadinessStateOnTradeClose } from './readiness-state.mjs'

const SYMBOLS = [
  { symbol: 'BTCUSDT', label: 'BTC', coingeckoId: 'bitcoin', sector: 'Store of Value' },
  { symbol: 'ETHUSDT', label: 'ETH', coingeckoId: 'ethereum', sector: 'Layer 1' },
  { symbol: 'SOLUSDT', label: 'SOL', coingeckoId: 'solana', sector: 'Layer 1' },
  { symbol: 'BNBUSDT', label: 'BNB', coingeckoId: 'binancecoin', sector: 'Exchange' },
  { symbol: 'XRPUSDT', label: 'XRP', coingeckoId: 'ripple', sector: 'Payments' },
  { symbol: 'DOGEUSDT', label: 'DOGE', coingeckoId: 'dogecoin', sector: 'Meme' },
  { symbol: 'AVAXUSDT', label: 'AVAX', coingeckoId: 'avalanche-2', sector: 'Layer 1' },
  { symbol: 'LINKUSDT', label: 'LINK', coingeckoId: 'chainlink', sector: 'Oracle' },
]

const app = express()
const PORT = 4174
const feishuNotifier = createFeishuWebhookNotifier()
const TTL_MS = 60 * 1000
const cache = new Map()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../../data-runtime')
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json')
const RUNTIME_STATE_FILE = path.join(DATA_DIR, 'runtime-state.json')
const DELIVERY_LOG_FILE = path.join(DATA_DIR, 'delivery-log.json')
const DIGEST_BUFFER_FILE = path.join(DATA_DIR, 'digest-buffer.json')

fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(ALERTS_FILE)) fs.writeFileSync(ALERTS_FILE, '[]', 'utf8')
if (!fs.existsSync(RUNTIME_STATE_FILE)) fs.writeFileSync(RUNTIME_STATE_FILE, JSON.stringify({ updatedAt: null, payload: null }, null, 2), 'utf8')
if (!fs.existsSync(DELIVERY_LOG_FILE)) fs.writeFileSync(DELIVERY_LOG_FILE, '[]', 'utf8')
if (!fs.existsSync(DIGEST_BUFFER_FILE)) fs.writeFileSync(DIGEST_BUFFER_FILE, JSON.stringify({ createdAt: null, items: [] }, null, 2), 'utf8')

app.use(cors())
app.use(express.json({ limit: '1mb' }))

function readAlerts() {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts.slice(0, 200), null, 2), 'utf8')
}

function readRuntimeState() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_STATE_FILE, 'utf8'))
  } catch {
    return { updatedAt: null, payload: null }
  }
}

function writeRuntimeState(state) {
  fs.writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function readDeliveryLog() {
  try {
    return JSON.parse(fs.readFileSync(DELIVERY_LOG_FILE, 'utf8'))
  } catch {
    return []
  }
}

function appendDeliveryLog(entry) {
  const existing = readDeliveryLog()
  existing.unshift(entry)
  fs.writeFileSync(DELIVERY_LOG_FILE, JSON.stringify(existing.slice(0, 200), null, 2), 'utf8')
}

function readDigestBuffer() {
  try {
    return JSON.parse(fs.readFileSync(DIGEST_BUFFER_FILE, 'utf8'))
  } catch {
    return { createdAt: null, items: [] }
  }
}

function writeDigestBuffer(value) {
  fs.writeFileSync(DIGEST_BUFFER_FILE, JSON.stringify(value, null, 2), 'utf8')
}

function severityForAlert(alert) {
  if (alert.kind === 'RISK_ALERT') return 'HIGH'
  if (alert.kind === 'LIVE_OK') return 'HIGH'
  if (alert.kind === 'LIVE_SMALL') return 'MEDIUM'
  return 'LOW'
}

function cooldownMsForSeverity(severity) {
  if (severity === 'HIGH') return 60 * 1000
  if (severity === 'MEDIUM') return 3 * 60 * 1000
  return 10 * 60 * 1000
}

function retryDelayMs(retryCount = 0) {
  return Math.min(15 * 60 * 1000, (retryCount + 1) * 60 * 1000)
}

function getTraderConfig() {
  const settings = readRuntimeState()?.payload?.settings ?? {}
  return {
    timeZone: settings.traderTimeZone || 'Asia/Shanghai',
    dayStartHour: Number.isFinite(settings.traderDayStartHour) ? settings.traderDayStartHour : 8,
    nightStartHour: Number.isFinite(settings.traderNightStartHour) ? settings.traderNightStartHour : 23,
    digestLiveOkDayWindowSec: Number.isFinite(settings.digestLiveOkDayWindowSec) ? settings.digestLiveOkDayWindowSec : 90,
    digestLiveOkNightWindowSec: Number.isFinite(settings.digestLiveOkNightWindowSec) ? settings.digestLiveOkNightWindowSec : 180,
    digestLiveSmallDayWindowSec: Number.isFinite(settings.digestLiveSmallDayWindowSec) ? settings.digestLiveSmallDayWindowSec : 300,
    digestLiveSmallNightWindowSec: Number.isFinite(settings.digestLiveSmallNightWindowSec) ? settings.digestLiveSmallNightWindowSec : 720,
    traderDayImmediateLiveOk: settings.traderDayImmediateLiveOk !== false,
    traderNightImmediateLiveOk: settings.traderNightImmediateLiveOk === true,
  }
}

function getTraderClock(now = new Date(), timeZone = 'Asia/Shanghai', dayStartHour = 8, nightStartHour = 23) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
  }).formatToParts(now)
  const hour = Number(parts.find((item) => item.type === 'hour')?.value ?? '0')
  const isDay = dayStartHour < nightStartHour
    ? hour >= dayStartHour && hour < nightStartHour
    : !(hour >= nightStartHour && hour < dayStartHour)
  const mode = isDay ? 'DAY' : 'NIGHT'
  return { hour, mode, timeZone }
}

function getDigestStrategy(items, now = new Date()) {
  const config = getTraderConfig()
  const clock = getTraderClock(now, config.timeZone, config.dayStartHour, config.nightStartHour)
  const hasLiveOk = items.some((item) => item.kind === 'LIVE_OK')
  const liveOkCount = items.filter((item) => item.kind === 'LIVE_OK').length
  const liveSmallCount = items.filter((item) => item.kind === 'LIVE_SMALL').length

  if (hasLiveOk) {
    return {
      ...clock,
      priority: 'LIVE_OK',
      label: clock.mode === 'DAY' ? '日间积极' : '夜间克制',
      windowMs: (clock.mode === 'DAY' ? config.digestLiveOkDayWindowSec : config.digestLiveOkNightWindowSec) * 1000,
      immediateKinds: clock.mode === 'DAY'
        ? (config.traderDayImmediateLiveOk ? ['LIVE_OK'] : [])
        : (config.traderNightImmediateLiveOk ? ['LIVE_OK'] : []),
      liveOkCount,
      liveSmallCount,
      config,
    }
  }

  return {
    ...clock,
    priority: 'LIVE_SMALL_ONLY',
    label: clock.mode === 'DAY' ? '日间观察' : '夜间静默',
    windowMs: (clock.mode === 'DAY' ? config.digestLiveSmallDayWindowSec : config.digestLiveSmallNightWindowSec) * 1000,
    immediateKinds: [],
    liveOkCount,
    liveSmallCount,
    config,
  }
}

function buildDigestAlert(items) {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const strategy = getDigestStrategy(items, nowDate)
  const liveOk = items.filter((i) => i.kind === 'LIVE_OK').length
  const liveSmall = items.filter((i) => i.kind === 'LIVE_SMALL').length

  const symbols = items.map((item) => item.title.match(/\] (\w+)/)?.[1]).filter(Boolean)
  const topSymbols = [...new Set(symbols)].slice(0, 3)

  const envMap = new Map()
  const execMap = new Map()
  const whyLines = []
  const lineItems = []
  let decisionPeriod = '15m'
  let structurePeriod = '1h'
  let topRisk = '-'
  let topNotional = '-'
  let topLeverage = '-'
  let topLevel = liveOk > 0 ? '标准仓' : '试单仓'
  for (const item of items) {
    const env = item.body.match(/策略 \/ 环境：(.*)/)?.[1]?.trim()
    if (env) envMap.set(env, (envMap.get(env) ?? 0) + 1)
    const exec = item.body.match(/执行状态：(.*)/)?.[1]?.trim()
    if (exec) execMap.set(exec, (execMap.get(exec) ?? 0) + 1)
    const why = item.body.match(/Why now：(.*)/)?.[1]?.trim()
    if (why && whyLines.length < 3) whyLines.push(`- ${why}`)
    const symbol = item.body.match(/标的：(.*)/)?.[1]?.trim() ?? item.title.match(/\] (\w+)/)?.[1] ?? 'UNKNOWN'
    const level = item.body.match(/级别：(.*)/)?.[1]?.trim() ?? '-'
    const entry = item.body.match(/入场区间：(.*)/)?.[1]?.trim() ?? '-'
    const stopTp = item.body.match(/止损 \/ 止盈一：(.*)/)?.[1]?.trim() ?? '-'
    lineItems.push(`${lineItems.length + 1}. ${symbol}｜${level}｜${entry}｜${stopTp}`)
    if (lineItems.length === 1) {
      decisionPeriod = item.body.match(/决策周期：(.*)/)?.[1]?.trim() ?? decisionPeriod
      structurePeriod = item.body.match(/结构周期：(.*)/)?.[1]?.trim() ?? structurePeriod
      topRisk = item.body.match(/建议风险：(.*)/)?.[1]?.trim() ?? topRisk
      topNotional = item.body.match(/建议名义仓位：(.*)/)?.[1]?.trim() ?? topNotional
      topLeverage = item.body.match(/建议杠杆：(.*)/)?.[1]?.trim() ?? topLeverage
      topLevel = item.body.match(/仓位级别说明：(.*)/)?.[1]?.trim() ?? topLevel
    }
  }

  const envSummary = [...envMap.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).slice(0, 4).join('，') || '无'
  const execSummary = [...execMap.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).slice(0, 4).join('，') || '无'

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    kind: liveOk > 0 ? 'LIVE_OK' : 'LIVE_SMALL',
    title: `[批量摘要 / ${strategy.priority} / ${strategy.label}] ${items.length} 条机会提醒（LIVE_OK ${liveOk} / LIVE_SMALL ${liveSmall}）`,
    body: [
      `结论：本窗口共 ${items.length} 条${liveOk > 0 ? '可下注/标准仓' : '小仓试单'}机会`,
      `摘要级别：${strategy.priority}`,
      `决策周期：${decisionPeriod}`,
      `结构周期：${structurePeriod}`,
      `Top Symbol：${topSymbols.join(' / ') || '无'}`,
      `环境 / 策略分布：${envSummary}`,
      `执行状态分布：${execSummary}`,
      `建议杠杆：${topLeverage}`,
      `建议风险：${topRisk}`,
      `建议名义仓位：${topNotional}`,
      `仓位级别说明：${topLevel}`,
      '',
      '窗口内机会：',
      ...(lineItems.length ? lineItems : ['- 暂无窗口内机会']),
      '',
      'Why now 摘要：',
      ...(whyLines.length ? whyLines : ['- 暂无 why-now 摘要']),
      '',
      `说明：当前为 ${strategy.label} 摘要模式，适合人工二次筛选后再执行。`,
    ].join('\n'),
    signature: `digest:${strategy.priority}:${items.map((i) => i.signature).join('|')}`,
    severity: liveOk > 0 ? 'HIGH' : 'MEDIUM',
    status: 'PENDING',
  }
}

function sma(values, period) {
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function pctDiff(price, avg) {
  return ((price - avg) / avg) * 100
}

function classifyEnvironment(s, settings) {
  if ((s.volatilityScore ?? 0) >= settings.extremeVolatilityThreshold && Math.abs(s.change24h ?? 0) > 6) return '极端事件候选'
  if ((s.ma20DiffPct ?? 0) <= settings.oversoldThreshold && (s.change24h ?? 0) < -3) return '恐慌/超卖'
  if ((s.ma20DiffPct ?? 0) >= settings.trendThreshold && (s.change24h ?? 0) > 1) return '趋势/牛市'
  if ((s.ma20DiffPct ?? 0) <= -settings.trendThreshold && (s.change24h ?? 0) < -1) return '弱势/空头'
  return '震荡'
}

function buildSignal(s, settings) {
  const environment = classifyEnvironment(s, settings)
  const price = s.price
  const signalBase = Math.round(50 + Math.max(0, Math.abs(s.ma20DiffPct ?? 0)) + Math.max(0, Math.abs(s.change24h) / 2) + Math.min(8, Math.abs((s.fundingRate ?? 0) * 10000)))
  if (environment === '恐慌/超卖') return { symbol: s.symbol, strategy: '均值回归', environment, score: Math.min(89, signalBase), entry: `${(price * 0.993).toFixed(2)} - ${price.toFixed(2)}`, stopLoss: (price * 0.965).toFixed(2), takeProfit1: (price * 1.03).toFixed(2), takeProfit2: (price * 1.06).toFixed(2), note: '恐慌环境下只吃修复段，排除项目级利空。' }
  if (environment === '趋势/牛市') return { symbol: s.symbol, strategy: '轮动跟随', environment, score: Math.min(92, signalBase + 4), entry: `${(price * 0.998).toFixed(2)} - ${(price * 1.004).toFixed(2)}`, stopLoss: (price * 0.972).toFixed(2), takeProfit1: (price * 1.05).toFixed(2), takeProfit2: (price * 1.1).toFixed(2), note: '优先做相对强度刚转正、资金回流的品种。' }
  if (environment === '弱势/空头') return { symbol: s.symbol, strategy: '趋势做空', environment, score: Math.min(90, signalBase + 2), entry: `${(price * 0.996).toFixed(2)} - ${price.toFixed(2)}`, stopLoss: (price * 1.028).toFixed(2), takeProfit1: (price * 0.96).toFixed(2), takeProfit2: (price * 0.93).toFixed(2), note: '弱势环境只做顺势空，不主观摸底。' }
  if (environment === '极端事件候选') return { symbol: s.symbol, strategy: '错价修复候选', environment, score: Math.min(85, signalBase), entry: '等待二次确认 / 回抽承接', stopLoss: (price * 0.96).toFixed(2), takeProfit1: (price * 1.025).toFixed(2), takeProfit2: (price * 1.05).toFixed(2), note: '必须能解释错价来源与修复力量。' }
  return { symbol: s.symbol, strategy: '均值回归', environment, score: Math.min(75, signalBase - 6), entry: '等待区间边缘 / 回踩确认', stopLoss: (price * 0.975).toFixed(2), takeProfit1: (price * 1.02).toFixed(2), takeProfit2: (price * 1.04).toFixed(2), note: '震荡市不追中间位置，宁缺毋滥。' }
}

async function cachedJson(key, url) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Upstream failed: ${url}`)
  const data = await res.json()
  cache.set(key, { ts: Date.now(), data })
  return data
}

app.get('/api/health', (_, res) => {
  const runtimeState = readRuntimeState()
  res.json({ ok: true, cacheKeys: [...cache.keys()].length, ttlMs: TTL_MS, alertsFile: ALERTS_FILE, runtimeStateFile: RUNTIME_STATE_FILE, runtimeUpdatedAt: runtimeState.updatedAt, feishuNotifierEnabled: feishuNotifier.enabled })
})

app.get('/api/runtime/state', (_, res) => {
  res.json(readRuntimeState())
})

app.get('/api/notifier/status', (_, res) => {
  const webhook = process.env.FEISHU_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL
  res.json({
    ok: true,
    provider: 'feishu-webhook',
    enabled: feishuNotifier.enabled,
    configured: Boolean(webhook),
    maskedWebhook: webhook ? `${webhook.slice(0, 24)}...` : null,
  })
})

app.get('/api/notifier/delivery-log', (_, res) => {
  res.json(readDeliveryLog())
})

app.get('/api/readiness-state', (_, res) => {
  res.json(readReadinessState())
})

app.post('/api/readiness-state/trade-close', (req, res) => {
  const result = updateReadinessStateOnTradeClose(req.body ?? {})
  res.json(result)
})

app.get('/api/notifier/queue-summary', (_, res) => {
  const alerts = readAlerts()
  const buffer = readDigestBuffer()
  const digestItems = (buffer.items ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    severity: item.severity ?? severityForAlert(item),
    createdAt: item.createdAt,
    signature: item.signature,
  }))
  const hasBufferedItems = Boolean(digestItems.length)
  const strategy = getDigestStrategy(buffer.items ?? [], hasBufferedItems && buffer.createdAt ? new Date(buffer.createdAt) : new Date())
  const nextDigestAt = hasBufferedItems && buffer.createdAt
    ? new Date(new Date(buffer.createdAt).getTime() + strategy.windowMs).toISOString()
    : null
  res.json({
    ok: true,
    pending: alerts.filter((a) => a.status === 'PENDING').length,
    failed: alerts.filter((a) => a.status === 'FAILED').length,
    sent: alerts.filter((a) => a.status === 'SENT').length,
    acked: alerts.filter((a) => a.status === 'ACKED').length,
    buffered: digestItems.length,
    traderMode: strategy.mode,
    digestPriority: strategy.priority,
    digestWindowMs: strategy.windowMs,
    configSource: 'runtime.settings',
    digestBufferCreatedAt: buffer.createdAt ?? null,
    nextDigestAt,
    digestItems,
    retrying: alerts.filter((a) => a.status === 'FAILED' && a.nextRetryAt).slice(0, 5),
  })
})

app.post('/api/runtime/state', (req, res) => {
  const next = { updatedAt: new Date().toISOString(), payload: req.body ?? null }
  writeRuntimeState(next)
  res.json({ ok: true, updatedAt: next.updatedAt })
})

app.get('/api/alerts', (req, res) => {
  const status = req.query.status
  const alerts = readAlerts()
  res.json(status ? alerts.filter((item) => item.status === status) : alerts)
})

async function tryDeliverAlert(alert) {
  const nowIso = new Date().toISOString()
  if (!feishuNotifier.enabled) {
    appendDeliveryLog({ ts: nowIso, alertId: alert.id, title: alert.title, provider: 'feishu-webhook', ok: false, message: 'missing webhook' })
    const alerts = readAlerts().map((item) => item.id === alert.id ? { ...item, status: 'FAILED', retryCount: (item.retryCount ?? 0) + 1, nextRetryAt: new Date(Date.now() + retryDelayMs(item.retryCount ?? 0)).toISOString(), lastDeliveryError: 'missing webhook' } : item)
    writeAlerts(alerts)
    return false
  }
  const result = await feishuNotifier.send(alert)
  appendDeliveryLog({ ts: nowIso, alertId: alert.id, title: alert.title, provider: result.provider, ok: result.ok, message: result.message ?? null })
  if (!result.ok) {
    console.error('feishu notifier send failed', result)
    const alerts = readAlerts().map((item) => item.id === alert.id ? { ...item, status: 'FAILED', retryCount: (item.retryCount ?? 0) + 1, nextRetryAt: new Date(Date.now() + retryDelayMs(item.retryCount ?? 0)).toISOString(), lastDeliveryError: result.message ?? 'send failed' } : item)
    writeAlerts(alerts)
    return false
  }
  const alerts = readAlerts().map((item) => item.id === alert.id ? { ...item, status: 'SENT', sentAt: nowIso, nextRetryAt: null, lastDeliveryError: null } : item)
  writeAlerts(alerts)
  return true
}

async function appendAlerts(incoming) {
  const existing = readAlerts()
  const signatures = new Set(existing.map((item) => item.signature))
  const deliveryLog = readDeliveryLog()
  const next = [...existing]
  const addedItems = []
  for (const item of incoming) {
    if (!item?.signature || signatures.has(item.signature)) continue
    signatures.add(item.signature)
    const severity = item.severity ?? severityForAlert(item)
    const recent = deliveryLog.find((log) => log.title === item.title && log.ok)
    const cooling = recent && (Date.now() - new Date(recent.ts).getTime()) < cooldownMsForSeverity(severity)
    const normalized = { ...item, severity, status: cooling ? 'FAILED' : (item.status ?? 'PENDING'), lastDeliveryError: cooling ? 'cooldown active' : null, nextRetryAt: cooling ? new Date(new Date(recent.ts).getTime() + cooldownMsForSeverity(severity)).toISOString() : null, retryCount: 0 }
    next.unshift(normalized)
    addedItems.push(normalized)
  }
  writeAlerts(next)

  const pendingItems = addedItems.filter((item) => item.status === 'PENDING')
  const immediateItems = pendingItems.filter((item) => item.kind === 'RISK_ALERT')
  const candidateBatchItems = pendingItems.filter((item) => item.kind !== 'RISK_ALERT')
  const strategy = getDigestStrategy(candidateBatchItems, new Date())
  const extraImmediateItems = candidateBatchItems.filter((item) => strategy.immediateKinds.includes(item.kind))
  const batchableItems = candidateBatchItems.filter((item) => !strategy.immediateKinds.includes(item.kind))

  for (const item of [...immediateItems, ...extraImmediateItems]) {
    try {
      await tryDeliverAlert(item)
    } catch (error) {
      console.error('alert delivery failed', error)
    }
  }

  if (batchableItems.length) {
    const nowIso = new Date().toISOString()
    const buffer = readDigestBuffer()
    const nextItems = [...(buffer.items ?? []), ...batchableItems]
    writeDigestBuffer({ createdAt: buffer.createdAt ?? nowIso, items: nextItems })
    const bufferedReason = strategy.priority === 'LIVE_SMALL_ONLY'
      ? `buffered for low-noise digest (${strategy.label})`
      : `buffered for priority digest (${strategy.label})`
    const alerts = readAlerts().map((item) => batchableItems.some((b) => b.id === item.id) ? { ...item, status: 'FAILED', nextRetryAt: null, lastDeliveryError: bufferedReason } : item)
    writeAlerts(alerts)
  }

  return { added: next.length - existing.length, total: readAlerts().length }
}

app.post('/api/alerts', async (req, res) => {
  const incoming = Array.isArray(req.body) ? req.body : [req.body]
  const result = await appendAlerts(incoming)
  res.json({ ok: true, ...result })
})

app.post('/api/alerts/emit', async (req, res) => {
  const emitted = emitAlertsFromSnapshot(req.body)
  const result = await appendAlerts(emitted)
  res.json({ ok: true, emitted: emitted.length, ...result })
})

app.post('/api/notifier/test-send', async (_, res) => {
  const alert = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: 'LIVE_OK',
    title: '[测试发送] Feishu notifier 连通性验证',
    body: '这是一条来自 crypto-contract-dashboard 独立应用的 Feishu webhook 测试消息。\n\n关键词：crypto\n\n如果你收到了它，说明 app-native Feishu notifier 已成功连通。',
    signature: `test-send:${Date.now()}`,
    status: 'PENDING',
  }
  const ok = await tryDeliverAlert(alert)
  res.json({ ok, provider: 'feishu-webhook' })
})

app.post('/api/notifier/flush-digest', async (_, res) => {
  const flushed = await flushDigestBuffer(true)
  res.json({ ok: true, flushed })
})

async function refreshRuntimeMarketData() {
  const state = readRuntimeState()
  const settings = state?.payload?.settings ?? {
    oversoldThreshold: -8,
    trendThreshold: 4,
    extremeVolatilityThreshold: 7,
  }
  const cgIds = SYMBOLS.map((s) => s.coingeckoId).join(',')
  const [fearGreed, coingecko] = await Promise.all([
    cachedJson('fear-greed', 'https://api.alternative.me/fng/'),
    cachedJson(`cg:${cgIds}`, `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgIds}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h`),
  ])
  const marketMap = new Map(coingecko.map((coin) => [coin.id, { marketCap: coin.market_cap, marketCapRank: coin.market_cap_rank }]))
  const snapshots = await Promise.all(SYMBOLS.map(async (cfg) => {
    const [ticker, oi, funding, klines] = await Promise.all([
      cachedJson(`ticker:${cfg.symbol}`, `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${cfg.symbol}`),
      cachedJson(`oi:${cfg.symbol}`, `https://fapi.binance.com/futures/data/openInterestHist?symbol=${cfg.symbol}&period=5m&limit=1`),
      cachedJson(`funding:${cfg.symbol}:1::`, `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${cfg.symbol}&limit=1`),
      cachedJson(`klines:${cfg.symbol}:1d:30`, `https://fapi.binance.com/fapi/v1/klines?symbol=${cfg.symbol}&interval=1d&limit=30`),
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
      sector: cfg.sector,
    }
  }))
  const signals = snapshots.map((s) => buildSignal(s, settings)).sort((a, b) => b.score - a.score)
  const executionLayer = buildServerExecutionLayer(signals, {
    accountEquity: state?.payload?.settings?.accountEquity ?? 10000,
    perTradeRiskPct: state?.payload?.settings?.perTradeRiskPct ?? 0.5,
    leverage: state?.payload?.settings?.leverage ?? 3,
    riskSoftCapUsd: state?.payload?.settings?.riskSoftCapUsd ?? 75,
    riskHardCapUsd: state?.payload?.settings?.riskHardCapUsd ?? 100,
    maxConcurrentRiskUsd: state?.payload?.settings?.maxConcurrentRiskUsd ?? 250,
  }, state?.payload?.paperTrades ?? [])
  writeRuntimeState({
    updatedAt: new Date().toISOString(),
    payload: {
      ...(state?.payload ?? {}),
      snapshots,
      signals,
      fearGreedValue: Number(fearGreed?.data?.[0]?.value ?? 50),
      ...executionLayer,
    },
  })
}

async function flushDigestBuffer(force = false) {
  const buffer = readDigestBuffer()
  if (!buffer.items?.length || !buffer.createdAt) return false
  const strategy = getDigestStrategy(buffer.items, new Date(buffer.createdAt))
  if (!force && Date.now() - new Date(buffer.createdAt).getTime() < strategy.windowMs) return false

  const digest = buildDigestAlert(buffer.items)
  const reason = force
    ? `manually flushed into ${strategy.priority} digest (${strategy.label})`
    : `grouped into ${strategy.priority} digest (${strategy.label})`
  const alerts = [digest, ...readAlerts().map((item) => buffer.items.some((b) => b.id === item.id) ? { ...item, status: 'ACKED', ackedAt: new Date().toISOString(), lastDeliveryError: reason } : item)]
  writeAlerts(alerts)
  writeDigestBuffer({ createdAt: null, items: [] })
  await tryDeliverAlert(digest)
  return true
}

async function retryFailedAlerts() {
  const alerts = readAlerts()
  const candidates = alerts.filter((item) => item.status === 'FAILED' && item.nextRetryAt && new Date(item.nextRetryAt).getTime() <= Date.now()).slice(0, 3)
  for (const item of candidates) {
    const reset = readAlerts().map((a) => a.id === item.id ? { ...a, status: 'PENDING' } : a)
    writeAlerts(reset)
    const pending = readAlerts().find((a) => a.id === item.id)
    if (pending) await tryDeliverAlert(pending)
  }
}

async function autonomousEmitFromRuntime() {
  const state = readRuntimeState()
  if (!state?.payload) return
  const emitted = emitAlertsFromSnapshot({
    signals: state.payload.signals?.map((signal) => ({
      signal,
      preview: state.payload.signalGatePreviews?.[signal.symbol],
      live: state.payload.signalLiveReadiness?.[signal.symbol],
      sizing: state.payload.signalSizingSuggestions?.[signal.symbol],
    })) ?? state.payload.signals ?? [],
    paperGateSummary: state.payload.paperGateSummary,
    settings: state.payload.settings,
  })
  if (!emitted.length) return
  await appendAlerts(emitted)
}

app.post('/api/alerts/:id/ack', (req, res) => {
  const alerts = readAlerts().map((item) => item.id === req.params.id ? { ...item, status: 'ACKED', ackedAt: new Date().toISOString() } : item)
  writeAlerts(alerts)
  res.json({ ok: true })
})

app.post('/api/alerts/:id/sent', (req, res) => {
  const alerts = readAlerts().map((item) => item.id === req.params.id ? { ...item, status: 'SENT', sentAt: new Date().toISOString() } : item)
  writeAlerts(alerts)
  res.json({ ok: true })
})

app.get('/api/fear-greed', async (_, res) => {
  try {
    const data = await cachedJson('fear-greed', 'https://api.alternative.me/fng/')
    res.json(data)
  } catch (error) {
    res.status(502).json({ error: String(error) })
  }
})

app.get('/api/coingecko/markets', async (req, res) => {
  try {
    const ids = req.query.ids
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h`
    const data = await cachedJson(`cg:${ids}`, url)
    res.json(data)
  } catch (error) {
    res.status(502).json({ error: String(error) })
  }
})

app.get('/api/binance/ticker24h', async (req, res) => {
  try {
    const symbol = req.query.symbol
    const data = await cachedJson(`ticker:${symbol}`, `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`)
    res.json(data)
  } catch (error) {
    res.status(502).json({ error: String(error) })
  }
})

app.get('/api/binance/funding', async (req, res) => {
  try {
    const symbol = req.query.symbol
    const limit = req.query.limit || '1'
    const startTime = req.query.startTime
    const endTime = req.query.endTime
    const params = new URLSearchParams({ symbol, limit })
    if (startTime) params.set('startTime', String(startTime))
    if (endTime) params.set('endTime', String(endTime))
    const cacheKey = `funding:${symbol}:${limit}:${startTime || ''}:${endTime || ''}`
    const data = await cachedJson(cacheKey, `https://fapi.binance.com/fapi/v1/fundingRate?${params.toString()}`)
    res.json(data)
  } catch (error) {
    res.status(502).json({ error: String(error) })
  }
})

app.get('/api/binance/open-interest', async (req, res) => {
  try {
    const symbol = req.query.symbol
    const data = await cachedJson(`oi:${symbol}`, `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=1`)
    res.json(data)
  } catch (error) {
    res.status(502).json({ error: String(error) })
  }
})

app.get('/api/binance/klines', async (req, res) => {
  try {
    const symbol = req.query.symbol
    const interval = req.query.interval || '1d'
    const limit = req.query.limit || '120'
    const data = await cachedJson(`klines:${symbol}:${interval}:${limit}`, `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
    res.json(data)
  } catch (error) {
    res.status(502).json({ error: String(error) })
  }
})

setInterval(() => {
  refreshRuntimeMarketData().catch((error) => {
    console.error('server-side market refresh failed', error)
  })
}, 15000)

setInterval(() => {
  autonomousEmitFromRuntime().catch((error) => {
    console.error('autonomous alert emission failed', error)
  })
}, 15000)

setInterval(() => {
  flushDigestBuffer().catch((error) => {
    console.error('flush digest buffer failed', error)
  })
}, 15000)

setInterval(() => {
  retryFailedAlerts().catch((error) => {
    console.error('retry failed alerts failed', error)
  })
}, 30000)

app.listen(PORT, () => {
  console.log(`crypto dashboard cache server listening on http://localhost:${PORT}`)
})
