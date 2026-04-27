import { useEffect, useMemo, useRef, useState } from 'react'
import type { MoonshotCandidate, MoonshotRadarResponse } from '../types'

type ChainFilter = 'ALL' | string
type PoolView = 'ALL' | 'EARLY_POOL' | 'PRIME_POOL' | 'RISK_POOL'
type SortBy = 'SCORE' | 'VOLUME_H1' | 'LIQUIDITY' | 'FRESHNESS' | 'RAVE_LIKE' | 'SAFETY' | 'PRIORITY'

function formatUsd(value?: number | null) {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '-'
  return `$${Math.round(num).toLocaleString()}`
}

function formatPct(value?: number | null) {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '-'
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
}

function ageLabel(hours?: number | null) {
  if (hours == null || !Number.isFinite(hours)) return '-'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function levelClass(level?: string) {
  if (level === 'EXTREME') return 'moonshot-level-extreme'
  if (level === 'HOT') return 'moonshot-level-hot'
  return 'moonshot-level-watch'
}

function safetyClass(item: MoonshotCandidate) {
  if (item.safety?.verdict === 'PASS') return 'moonshot-safety-watchable'
  if (item.safety?.verdict === 'WARN') return 'moonshot-safety-provider'
  if (item.safety?.provider && item.safety?.meta?.implemented === false) return 'moonshot-safety-provider'
  return 'moonshot-safety-caution'
}

function lifecycleClass(stage?: string) {
  if (stage === 'CONFIRMED') return 'moonshot-stage-confirmed'
  if (stage === 'HEATING') return 'moonshot-stage-heating'
  if (stage === 'COOLING') return 'moonshot-stage-cooling'
  return 'moonshot-stage-new'
}

function transitionToneClass(tone?: string) {
  if (tone === 'ACTION') return 'moonshot-tone-action'
  if (tone === 'RISK') return 'moonshot-tone-risk'
  return 'moonshot-tone-watch'
}

function executionTierClass(tier?: string) {
  if (tier === 'A') return 'moonshot-tier-a'
  if (tier === 'B') return 'moonshot-tier-b'
  if (tier === 'C') return 'moonshot-tier-c'
  return 'moonshot-tier-r'
}

function feedbackClass(label?: string) {
  if (label === 'POSITIVE_EDGE' || label === 'UPSIDE_EDGE') return 'moonshot-tone-action'
  if (label === 'NEGATIVE_EDGE') return 'moonshot-tone-risk'
  return 'moonshot-tone-watch'
}

function safetyPriority(item: MoonshotCandidate) {
  if (item.safety?.verdict === 'PASS') return 3
  if (item.safety?.verdict === 'WARN') return 2
  if (item.safety?.verdict === 'DOWNGRADE') return 1
  return 0
}

function lifecyclePriority(item: MoonshotCandidate) {
  if (item.lifecycle?.stage === 'CONFIRMED') return 4
  if (item.lifecycle?.stage === 'HEATING') return 3
  if (item.lifecycle?.stage === 'NEW') return 2
  if (item.lifecycle?.stage === 'COOLING') return 1
  return 0
}

function poolCategory(item: MoonshotCandidate) {
  const tone = item.lifecycle?.transitionTone ?? 'WATCH'
  const priority = item.lifecycle?.transitionPriority ?? 0
  if (tone === 'ACTION' && safetyPriority(item) >= 3 && priority >= 78 && (item.raveLike?.total ?? 0) >= 58 && (item.score?.total ?? 0) >= 80) return 'PRIME_POOL'
  if (tone === 'WATCH' && safetyPriority(item) >= 1 && (item.score?.total ?? 0) >= 60) return 'EARLY_POOL'
  if (tone === 'RISK' && priority >= 80 && item.lifecycle?.stage === 'COOLING') return 'RISK_POOL'
  return 'GENERAL'
}

function inPrimePool(item: MoonshotCandidate) {
  return poolCategory(item) === 'PRIME_POOL'
}

function inEarlyPool(item: MoonshotCandidate) {
  return poolCategory(item) === 'EARLY_POOL'
}

function inRiskPool(item: MoonshotCandidate) {
  return poolCategory(item) === 'RISK_POOL'
}

function candidatePriorityScore(item: MoonshotCandidate) {
  const toneWeight = item.lifecycle?.transitionTone === 'ACTION' ? 1000 : item.lifecycle?.transitionTone === 'WATCH' ? 600 : 150
  const safetyWeight = safetyPriority(item) * 120
  const pool = poolCategory(item)
  const poolWeight = pool === 'PRIME_POOL' ? 220 : pool === 'EARLY_POOL' ? 120 : pool === 'RISK_POOL' ? -50 : 0
  return toneWeight + safetyWeight + poolWeight + (item.lifecycle?.transitionPriority ?? 0) * 4 + lifecyclePriority(item) * 20 + (item.raveLike?.total ?? 0) * 2 + (item.score?.total ?? 0)
}

function poolCardClass(item: MoonshotCandidate) {
  const pool = poolCategory(item)
  if (pool === 'PRIME_POOL') return 'moonshot-item-prime'
  if (pool === 'EARLY_POOL') return 'moonshot-item-early'
  if (pool === 'RISK_POOL') return 'moonshot-item-risk'
  return 'moonshot-item-general'
}

function poolDescription(poolView: PoolView) {
  if (poolView === 'PRIME_POOL') return '精选池：更偏可优先复核的行动候选，尽量把强确认和高质量样本收在这里。'
  if (poolView === 'EARLY_POOL') return '预警池：更偏继续观察的升温候选，适合盯后续是否继续强化。'
  if (poolView === 'RISK_POOL') return '风险池：更偏转弱/降温/质量走差的候选，用来防追高和看衰退。'
  return '全部：按统一优先级查看当前全量候选。'
}

function poolActionHint(poolView: PoolView) {
  if (poolView === 'PRIME_POOL') return '优先人工复核是否仍在发酵，重点看 breakout 是否延续、流动性是否继续跟上。'
  if (poolView === 'EARLY_POOL') return '观察后续 1-3 轮扫描是否继续强化，重点看是否升到 CONFIRMED。'
  if (poolView === 'RISK_POOL') return '留意回落是否延续、风险是否继续恶化，避免把降温样本误当成二次机会。'
  return '先按优先级扫全局，再决定切进精选池、预警池或风险池做细看。'
}

function candidateActionHint(item: MoonshotCandidate) {
  const pool = poolCategory(item)
  if (pool === 'PRIME_POOL') return '建议动作：优先复核，确认是否还在持续发酵。'
  if (pool === 'EARLY_POOL') return '建议动作：继续观察，等下一轮强化或升级。'
  if (pool === 'RISK_POOL') return '建议动作：保持谨慎，重点防追高和误判反弹。'
  return '建议动作：先快速浏览，再决定是否进入重点池子。'
}

function candidateTimingHint(item: MoonshotCandidate) {
  return item.lifecycle?.timingHint ?? '时机建议：先继续观察。'
}

function regimeCardCopy(item: MoonshotCandidate, regime: MoonshotRadarResponse['regime']) {
  const tone = regime?.tone ?? 'WATCH'
  const strength = regime?.shift?.strengthLabel ?? 'LIGHT'
  const policy = regime?.playbook?.alertPolicy ?? 'EARLY_BALANCED'
  const pool = poolCategory(item)
  const breakout = item.score?.acceleration?.breakout === true
  const sustained = (item.score?.acceleration?.sustainedScans ?? 0) >= 2
  const cooling = item.lifecycle?.stage === 'COOLING'
  const safetyWeak = item.safety?.verdict === 'DOWNGRADE' || item.safety?.verdict === 'BLOCK'
  const copyPosture = item.feedback?.copyPosture ?? 'NEUTRAL'

  let headline = item.lifecycle?.decisionLine ?? '先观察：暂无明确决策短句'
  let emphasis = '中性观察'
  let note = candidateActionHint(item)

  if (tone === 'ACTION') {
    emphasis = strength === 'STRONG' ? '进攻优先' : '选择性进攻'
    headline = breakout || sustained
      ? '优先看强确认：这类更像仍在发酵，不只是单轮异动。'
      : pool === 'PRIME_POOL'
        ? '优先看精选池：先确认它是不是还能继续强化。'
        : '进攻环境里先看质量，再看是否补确认。'
    note = policy === 'AGGRESSIVE_ACTION'
      ? '当前文案重心：breakout、确认、执行等级、立刻复核。'
      : '当前文案重心：质量优先，避免把观察池误当主战场。'
  } else if (tone === 'RISK') {
    emphasis = strength === 'STRONG' ? '防守优先' : '风险收缩'
    headline = cooling || safetyWeak || pool === 'RISK_POOL'
      ? '优先看风险迁移：这类更像转弱/降温，不要轻易当二次机会。'
      : '防守环境下先看风险标签和 Safety，再谈进攻可能。'
    note = policy === 'DEFENSIVE_RISK'
      ? '当前文案重心：风险标签、Cooling、Safety 弱项、避免追高。'
      : '当前文案重心：先收缩，再筛掉不够硬的样本。'
  } else {
    emphasis = policy === 'CONFIRM_HEAVY' ? '确认优先' : '观察优先'
    headline = policy === 'CONFIRM_HEAVY'
      ? '先等确认：这轮更重连续性，不急着把早期异动当机会。'
      : pool === 'EARLY_POOL'
        ? '先盯升温：观察它是否继续强化、是否升级到确认段。'
        : '当前更像观察窗口，先让结构自己走出来。'
    note = policy === 'CONFIRM_HEAVY'
      ? '当前文案重心：等确认、别急、连续性优先。'
      : '当前文案重心：发现新苗头，但不急着下重判断。'
  }

  if (copyPosture === 'CONFIDENT_ACTION') {
    emphasis = '反馈强化确认'
    note = item.feedback?.copyNote ?? '高置信反馈下，文案可以更明确强调确认与优先复核。'
  } else if (copyPosture === 'SOFT_ACTION') {
    emphasis = '反馈轻推'
    note = item.feedback?.copyNote ?? '反馈偏正，但仍应保留确认空间。'
  } else if (copyPosture === 'RISK_ALERT') {
    emphasis = '反馈压制'
    note = item.feedback?.copyNote ?? '历史负反馈生效，文案应明显偏谨慎。'
  } else if (copyPosture === 'LOW_CONFIDENCE') {
    emphasis = '弱参考'
    note = item.feedback?.copyNote ?? '当前反馈置信偏低，只适合作弱提示。'
  } else if (copyPosture === 'DEFENSIVE') {
    emphasis = '反馈转弱'
    note = item.feedback?.copyNote ?? '近期反馈转弱，先把语气收回来。'
  }

  return { headline, emphasis, note }
}

function marketRegimeSummary(candidates: MoonshotCandidate[]) {
  const total = candidates.length || 1
  const tierA = candidates.filter((item) => item.lifecycle?.executionTier === 'A').length
  const tierB = candidates.filter((item) => item.lifecycle?.executionTier === 'B').length
  const tierR = candidates.filter((item) => item.lifecycle?.executionTier === 'R' || !item.lifecycle?.executionTier).length
  const prime = candidates.filter(inPrimePool).length
  const risk = candidates.filter(inRiskPool).length
  const action = candidates.filter((item) => item.lifecycle?.transitionTone === 'ACTION').length
  const riskTone = candidates.filter((item) => item.lifecycle?.transitionTone === 'RISK').length

  if ((tierA + tierB) / total >= 0.45 && prime >= risk && action >= riskTone) {
    return {
      tone: 'ACTION' as const,
      title: '当前偏进攻',
      body: 'A/B 级候选占比上升，精选池样本不弱，适合优先看强确认与持续强化标的。'
    }
  }
  if (tierR / total >= 0.35 || risk > prime || riskTone > action) {
    return {
      tone: 'RISK' as const,
      title: '当前偏防守',
      body: 'R 级或风险迁移占比抬升，先以防追高、防假突破、防回落误判为主。'
    }
  }
  return {
    tone: 'WATCH' as const,
    title: '当前偏观察',
    body: '市场更像观察窗口，先盯 B/C 级与预警池样本，等待进一步升级确认。'
  }
}

const MOONSHOT_EXPANDED_KEY_STORAGE = 'moonshot-radar-expanded-key'
const MOONSHOT_SORT_REFRESH_MS = 30000
const MOONSHOT_MAJOR_SCORE_DELTA = 5
const MOONSHOT_MAJOR_PRIORITY_DELTA = 120



function isMajorCandidateChange(prev: MoonshotRadarResponse['candidates'][number] | undefined, next: MoonshotRadarResponse['candidates'][number]) {
  if (!prev) return true
  const prevScore = prev.score?.total ?? 0
  const nextScore = next.score?.total ?? 0
  const prevPriority = prev.lifecycle?.transitionPriority ?? 0
  const nextPriority = next.lifecycle?.transitionPriority ?? 0
  return (
    prev.lifecycle?.stage !== next.lifecycle?.stage
    || prev.lifecycle?.executionTier !== next.lifecycle?.executionTier
    || prev.lifecycle?.transitionTone !== next.lifecycle?.transitionTone
    || poolCategory(prev) !== poolCategory(next)
    || prev.feedback?.label !== next.feedback?.label
    || Math.abs(prevScore - nextScore) >= MOONSHOT_MAJOR_SCORE_DELTA
    || Math.abs(prevPriority - nextPriority) >= MOONSHOT_MAJOR_PRIORITY_DELTA
  )
}

export function MoonshotRadarPanel({ radar }: { radar: MoonshotRadarResponse | null }) {
  const [chainFilter, setChainFilter] = useState<ChainFilter>('ALL')
  const [poolView, setPoolView] = useState<PoolView>('ALL')
  const [sortBy, setSortBy] = useState<SortBy>('PRIORITY')
  const [highQualityOnly, setHighQualityOnly] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(MOONSHOT_EXPANDED_KEY_STORAGE) || null
  })
  const [regimeExpanded, setRegimeExpanded] = useState(false)
  const frozenOrderRef = useRef<string[]>([])
  const frozenCandidatesRef = useRef<typeof candidates>([])
  const lastSortRefreshRef = useRef(0)
  const hoverFreezeRef = useRef(false)
  const candidates = radar?.candidates ?? []
  const chains = useMemo(() => ['ALL', ...new Set(candidates.map((item) => item.chainId).filter(Boolean))], [candidates])

  const earlyCount = candidates.filter(inEarlyPool).length
  const primeCount = candidates.filter(inPrimePool).length
  const riskCount = candidates.filter(inRiskPool).length
  const tierACount = candidates.filter((item) => item.lifecycle?.executionTier === 'A').length
  const tierBCount = candidates.filter((item) => item.lifecycle?.executionTier === 'B').length
  const tierCCount = candidates.filter((item) => item.lifecycle?.executionTier === 'C').length
  const tierRCount = candidates.filter((item) => item.lifecycle?.executionTier === 'R' || !item.lifecycle?.executionTier).length

  const regime = useMemo(() => radar?.regime ?? marketRegimeSummary(candidates), [radar?.regime, candidates])


  useEffect(() => {
    if (typeof window === 'undefined') return
    if (expandedKey) window.localStorage.setItem(MOONSHOT_EXPANDED_KEY_STORAGE, expandedKey)
    else window.localStorage.removeItem(MOONSHOT_EXPANDED_KEY_STORAGE)
  }, [expandedKey])

  const visible = useMemo(() => {
    const filtered = candidates
      .filter((item) => chainFilter === 'ALL' || item.chainId === chainFilter)
      .filter((item) => !highQualityOnly || inPrimePool(item))
      .filter((item) => {
        if (poolView === 'EARLY_POOL') return inEarlyPool(item)
        if (poolView === 'PRIME_POOL') return inPrimePool(item)
        if (poolView === 'RISK_POOL') return inRiskPool(item)
        return true
      })

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'VOLUME_H1') return (b.score?.metrics?.volumeH1 ?? 0) - (a.score?.metrics?.volumeH1 ?? 0)
      if (sortBy === 'LIQUIDITY') return (b.score?.metrics?.liquidityUsd ?? 0) - (a.score?.metrics?.liquidityUsd ?? 0)
      if (sortBy === 'FRESHNESS') return (a.score?.metrics?.ageHours ?? 999999) - (b.score?.metrics?.ageHours ?? 999999)
      if (sortBy === 'RAVE_LIKE') return (b.raveLike?.total ?? 0) - (a.raveLike?.total ?? 0)
      if (sortBy === 'SAFETY') return safetyPriority(b) - safetyPriority(a)
      if (sortBy === 'PRIORITY') {
        return candidatePriorityScore(b) - candidatePriorityScore(a)
          || safetyPriority(b) - safetyPriority(a)
          || lifecyclePriority(b) - lifecyclePriority(a)
          || Number(Boolean(b.lifecycle?.changed)) - Number(Boolean(a.lifecycle?.changed))
          || (b.raveLike?.total ?? 0) - (a.raveLike?.total ?? 0)
          || (b.score?.total ?? 0) - (a.score?.total ?? 0)
      }
      return (b.score?.total ?? 0) - (a.score?.total ?? 0)
    })

    const sortedMap = new Map(sorted.map((item) => [`${item.chainId}:${item.pairAddress}`, item]))
    const prevMap = new Map((frozenCandidatesRef.current ?? []).map((item) => [`${item.chainId}:${item.pairAddress}`, item]))
    const hasMajorChange = sorted.some((item) => isMajorCandidateChange(prevMap.get(`${item.chainId}:${item.pairAddress}`), item))
    const filteredKeys = new Set(sorted.map((item) => `${item.chainId}:${item.pairAddress}`))
    const readingFreeze = (expandedKey && filteredKeys.has(expandedKey)) || hoverFreezeRef.current
    const nowTs = Date.now()
    const shouldResort = !readingFreeze && (hasMajorChange || !lastSortRefreshRef.current || (nowTs - lastSortRefreshRef.current) >= MOONSHOT_SORT_REFRESH_MS)

    if (shouldResort || !frozenOrderRef.current.length) {
      frozenOrderRef.current = sorted.map((item) => `${item.chainId}:${item.pairAddress}`)
      frozenCandidatesRef.current = sorted
      lastSortRefreshRef.current = nowTs
      return sorted
    }

    const stable = frozenOrderRef.current
      .map((key) => sortedMap.get(key))
      .filter((item): item is typeof sorted[number] => Boolean(item))
    const knownKeys = new Set(stable.map((item) => `${item.chainId}:${item.pairAddress}`))
    const tail = sorted.filter((item) => !knownKeys.has(`${item.chainId}:${item.pairAddress}`))
    const merged = [...stable, ...tail]
    frozenCandidatesRef.current = merged
    return merged
  }, [candidates, chainFilter, sortBy, highQualityOnly, poolView, expandedKey])

  return (
    <div className="card moonshot-card">
      <div className="panel-header" style={{ marginBottom: 12 }}>
        <div>
          <h3>Moonshot Radar · 全链暴涨雷达</h3>
          <div className="muted">
            扫描时间：{radar?.scannedAt ?? '-'}
            {radar?.sources ? ` · seeds ${radar.sources.seedCount ?? 0} · candidates ${candidates.length}` : ''}
          </div>
          <div className="muted">提醒节奏：EARLY 先提醒，CONFIRM 二次确认；Safety provider 支持 local-heuristic / goplus。</div>
        </div>
        <div className="signal-toolbar">
          <label>
            <span className="muted">链过滤</span>
            <select value={chainFilter} onChange={(e) => setChainFilter(e.target.value)}>
              {chains.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
            </select>
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={highQualityOnly} onChange={(e) => setHighQualityOnly(e.target.checked)} />
            <span className="muted">只看高质量候选</span>
          </label>
          <label>
            <span className="muted">排序</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="PRIORITY">按实盘优先级</option>
              <option value="SCORE">按 Moon Score</option>
              <option value="RAVE_LIKE">按 RAVE-like</option>
              <option value="SAFETY">按 Safety</option>
              <option value="VOLUME_H1">按 1h 成交额</option>
              <option value="LIQUIDITY">按流动性</option>
              <option value="FRESHNESS">按新鲜度</option>
            </select>
          </label>
        </div>
      </div>

      <div className={`moonshot-regime-box ${transitionToneClass(regime.tone)}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="moonshot-regime-title">{regime.title}</div>
            <div className="moonshot-regime-body">{regime.body}</div>
            <div className="muted" style={{ marginTop: 6 }}>
              强度：<span className={`summary-chip ${transitionToneClass(radar?.regime?.shift?.tone ?? regime.tone)}`}>{radar?.regime?.shift?.strengthLabel ?? 'LIGHT'}</span>
              {radar?.regime?.shift?.sameToneStreak != null ? <> · streak <strong>{radar.regime.shift.sameToneStreak}</strong></> : null}
              {radar?.regime?.shift?.flipsLast4 != null ? <> · flips <strong>{radar.regime.shift.flipsLast4}</strong></> : null}
            </div>
          </div>
          <button className="ghost-btn small-btn" onClick={() => setRegimeExpanded((v) => !v)}>
            {regimeExpanded ? '收起详情' : '展开详情'}
          </button>
        </div>
        {regimeExpanded ? (
          <>
            {radar?.regime?.shift ? (
              <div className={`moonshot-regime-shift ${transitionToneClass(radar.regime.shift.tone)}`}>
                <strong>{radar.regime.shift.label}</strong>
                <div>{radar.regime.shift.body}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  强度：<span className={`summary-chip ${transitionToneClass(radar.regime.shift.tone)}`}>{radar.regime.shift.strengthLabel ?? 'LIGHT'}</span>
                  {' '}· score：<strong>{radar.regime.shift.strengthScore ?? 0}</strong>
                  {' '}· streak：<strong>{radar.regime.shift.sameToneStreak ?? 0}</strong>
                  {' '}· 近 4 轮 flips：<strong>{radar.regime.shift.flipsLast4 ?? 0}</strong>
                  {radar.regime.shift.fakeShift ? ' · 疑似假切换后回切' : ''}
                </div>
              </div>
            ) : null}
            {radar?.regime?.playbook ? (
              <div className={`moonshot-regime-playbook ${transitionToneClass(regime.tone)}`}>
                <strong>{radar.regime.playbook.title ?? '当前打法'}</strong>
                <div>{radar.regime.playbook.body}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Focus Pool：<span className="summary-chip">{radar.regime.playbook.focusPool ?? '-'}</span>
                  {' '}· Alert Bias：<span className="summary-chip">{radar.regime.playbook.alertBias ?? '-'}</span>
                  {' '}· Review：<span className="summary-chip">{radar.regime.playbook.reviewCadence ?? '-'}</span>
                  {' '}· Mode：<span className="summary-chip">{radar.regime.playbook.mode ?? '-'}</span>
                  {' '}· Ranking：<span className="summary-chip">{radar.regime.playbook.rankingMode ?? '-'}</span>
                  {' '}· Alerts：<span className="summary-chip">{radar.regime.playbook.alertPolicy ?? '-'}</span>
                </div>
              </div>
            ) : null}
            {radar?.replay ? (
              <div className={`moonshot-regime-playbook ${transitionToneClass(regime.tone)}`}>
                <strong>{radar.replay.title}</strong>
                <div>{radar.replay.body}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Confirmed：<span className="summary-chip">{radar.replay.metrics?.confirmed ?? 0}</span>
                  {' '}· Heating：<span className="summary-chip">{radar.replay.metrics?.heating ?? 0}</span>
                  {' '}· Cooling：<span className="summary-chip">{radar.replay.metrics?.cooling ?? 0}</span>
                  {' '}· Breakout：<span className="summary-chip">{radar.replay.metrics?.breakoutCount ?? 0}</span>
                  {' '}· Avg scoreΔ：<span className="summary-chip">{radar.replay.metrics?.avgScoreDelta ?? 0}</span>
                  {' '}· 升级到 CONFIRM：<span className="summary-chip">{radar.replay.metrics?.promotedToConfirm ?? 0}</span>
                  {' '}· 被 policy 压掉：<span className="summary-chip">{radar.replay.metrics?.blockedByPolicy ?? 0}</span>
                  {' '}· 已跟踪：<span className="summary-chip">{radar.replay.metrics?.tracked ?? 0}</span>
                  {' '}· 已解析：<span className="summary-chip">{radar.replay.metrics?.resolved ?? 0}</span>
                  {' '}· WIN / FAIL / MIXED：<span className="summary-chip">{radar.replay.metrics?.wins ?? 0} / {radar.replay.metrics?.fails ?? 0} / {radar.replay.metrics?.mixes ?? 0}</span>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  Pool：{radar.replay.buckets?.pool?.slice(0, 3).map((item) => `${item.key} ${item.winRate}% (${item.wins}/${item.total})`).join(' · ') || '-'}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Tier：{radar.replay.buckets?.executionTier?.slice(0, 4).map((item) => `${item.key} ${item.winRate}% (${item.wins}/${item.total})`).join(' · ') || '-'}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Lifecycle：{radar.replay.buckets?.lifecycleStage?.slice(0, 4).map((item) => `${item.key} ${item.winRate}% (${item.wins}/${item.total})`).join(' · ') || '-'}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Tone：{radar.replay.buckets?.transitionTone?.slice(0, 3).map((item) => `${item.key} ${item.winRate}% (${item.wins}/${item.total})`).join(' · ') || '-'}
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  Best WinRate：{radar.replay.buckets?.leaderboard?.bestWinRate?.map((item) => `${item.key} ${item.winRate}%`).join(' · ') || '-'}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Best Upside：{radar.replay.buckets?.leaderboard?.bestUpside?.map((item) => `${item.key} +${item.avgMaxUpPct}%`).join(' · ') || '-'}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Worst FailRate：{radar.replay.buckets?.leaderboard?.worstFailRate?.map((item) => `${item.key} ${item.failRate}%`).join(' · ') || '-'}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="moonshot-summary-grid">
        <div><span className="muted">EXTREME</span><strong>{candidates.filter((item) => item.score?.level === 'EXTREME').length}</strong></div>
        <div><span className="muted">HOT</span><strong>{candidates.filter((item) => item.score?.level === 'HOT').length}</strong></div>
        <div><span className="muted">Early Pool</span><strong>{earlyCount}</strong></div>
        <div><span className="muted">Prime Pool</span><strong>{primeCount}</strong></div>
        <div><span className="muted">Risk Pool</span><strong>{riskCount}</strong></div>
        <div><span className="muted">Tier A</span><strong>{tierACount}</strong></div>
        <div><span className="muted">Tier B</span><strong>{tierBCount}</strong></div>
        <div><span className="muted">Tier C</span><strong>{tierCCount}</strong></div>
        <div><span className="muted">Tier R</span><strong>{tierRCount}</strong></div>
      </div>

      <div className="moonshot-pool-tabs">
        <button className={`ghost-btn small-btn ${poolView === 'ALL' ? 'moonshot-tab-active' : ''}`} onClick={() => setPoolView('ALL')}>全部</button>
        <button className={`ghost-btn small-btn ${poolView === 'EARLY_POOL' ? 'moonshot-tab-active' : ''}`} onClick={() => setPoolView('EARLY_POOL')}>预警池</button>
        <button className={`ghost-btn small-btn ${poolView === 'PRIME_POOL' ? 'moonshot-tab-active' : ''}`} onClick={() => setPoolView('PRIME_POOL')}>精选池</button>
        <button className={`ghost-btn small-btn ${poolView === 'RISK_POOL' ? 'moonshot-tab-active' : ''}`} onClick={() => setPoolView('RISK_POOL')}>风险池</button>
      </div>
      <div className="muted moonshot-pool-description">{poolDescription(poolView)}</div>
      <div className="moonshot-pool-hint">{poolActionHint(poolView)}</div>

      <div className="moonshot-list" onMouseEnter={() => { hoverFreezeRef.current = true }} onMouseLeave={() => { hoverFreezeRef.current = false }}>
        {visible.slice(0, 12).map((item: MoonshotCandidate) => {
          const rowKey = `${item.chainId}:${item.pairAddress}`
          const expanded = expandedKey === rowKey
          const poolLabel = poolCategory(item)
          const cardCopy = regimeCardCopy(item, radar?.regime)
          return (
            <div key={rowKey} className={`moonshot-item ${poolCardClass(item)}`}>
              <div className="moonshot-item-head">
                <div>
                  <div className="tag-row" style={{ marginBottom: 6 }}>
                    <span className={`moonshot-level ${levelClass(item.score?.level)}`}>{item.score?.level ?? 'WATCH'}</span>
                    <span className="report-tag">{item.chainId}</span>
                    <span className="report-tag">{item.dexId}</span>
                    <span className="report-tag">{poolLabel}</span>
                    <span className={`report-tag ${lifecycleClass(item.lifecycle?.stage)}`}>{item.lifecycle?.stage ?? 'NEW'}</span>
                    <span className={`report-tag ${safetyClass(item)}`}>{item.safety?.verdict ?? (item.safety?.safeToWatch ? 'PASS' : item.safety?.provider || 'CAUTION')}</span>
                    <span className={`report-tag ${transitionToneClass(item.lifecycle?.transitionTone)}`}>{item.lifecycle?.transitionTone ?? 'WATCH'}</span>
                    <span className={`report-tag ${executionTierClass(item.lifecycle?.executionTier)}`}>{item.lifecycle?.executionTier ?? 'R'}</span>
                    <span className="report-tag">P{item.lifecycle?.transitionPriority ?? 0}</span>
                  </div>
                  <div><strong>{item.symbol}</strong> <span className="muted">/ {item.quoteSymbol} · {item.name}</span></div>
                </div>
                <div className="moonshot-score-block">
                  <strong>{item.score?.total ?? 0}</strong>
                  <span className="muted">Moon Score</span>
                </div>
              </div>

              <div className="moonshot-metrics-grid">
                <div><span className="muted">1h / 6h / 24h</span><strong>{formatPct(item.score?.metrics?.changeH1)} / {formatPct(item.score?.metrics?.changeH6)} / {formatPct(item.score?.metrics?.changeH24)}</strong></div>
                <div><span className="muted">1h 成交额</span><strong>{formatUsd(item.score?.metrics?.volumeH1)}</strong></div>
                <div><span className="muted">流动性</span><strong>{formatUsd(item.score?.metrics?.liquidityUsd)}</strong></div>
                <div><span className="muted">Age</span><strong>{ageLabel(item.score?.metrics?.ageHours)}</strong></div>
                <div><span className="muted">scoreΔ / breakout</span><strong>{item.score?.acceleration?.scoreDelta >= 0 ? '+' : ''}{item.score?.acceleration?.scoreDelta ?? 0} / {item.score?.acceleration?.breakout ? 'YES' : 'NO'}</strong></div>
                <div><span className="muted">1h 加速度</span><strong>vol {item.score?.acceleration?.volumeH1Ratio?.toFixed(2) ?? '1.00'}x · txns {item.score?.acceleration?.txnsH1Ratio?.toFixed(2) ?? '1.00'}x</strong></div>
                <div><span className="muted">RAVE-like</span><strong>{item.raveLike?.label ?? 'WEAK'} / {item.raveLike?.total ?? 0}</strong></div>
                <div><span className="muted">Safety</span><strong>{item.safety?.verdict ?? (item.safety?.safeToWatch ? 'PASS' : 'CAUTION')}</strong></div>
              </div>

              <div className="moonshot-decision-line"><strong>{cardCopy.headline}</strong></div>
              <div className="muted moonshot-reasons">执行等级：<span className={`summary-chip ${executionTierClass(item.lifecycle?.executionTier)}`}>{item.lifecycle?.executionTier ?? 'R'}</span> · 生命周期：{item.lifecycle?.stage ?? 'NEW'}</div>
              <div className="muted moonshot-reasons">反馈：<span className={`summary-chip ${feedbackClass(item.feedback?.label)}`}>{item.feedback?.label ?? 'NO_SIGNAL'}</span>{item.feedback?.confidenceLabel ? ` · ${item.feedback.confidenceLabel}` : ''}{item.feedback?.reversalActive ? ' · 转弱' : ''}</div>
              <div className="moonshot-action-hint">{cardCopy.note}</div>
              <div className="moonshot-timing-hint">{candidateTimingHint(item)}</div>
              {item.riskFlags?.length ? <div className="muted moonshot-risk">风险标签：{item.riskFlags.join('，')}</div> : <div className="muted moonshot-risk">风险标签：未见明显结构性风险标签</div>}

              <div className="tag-row" style={{ marginTop: 10 }}>
                <button className="ghost-btn small-btn" onClick={() => setExpandedKey(expanded ? null : rowKey)}>{expanded ? '收起详情' : '展开详情'}</button>
                <a className="ghost-btn small-btn moonshot-link-btn" href={item.url} target="_blank" rel="noreferrer">打开 DexScreener</a>
              </div>

              {expanded ? (
                <div className="moonshot-detail-grid">
                  <div className="moonshot-detail-card">
                    <h4>Decision Detail</h4>
                    <div className="muted">decisionLine：{item.lifecycle?.decisionLine ?? '-'}</div>
                    <div className="muted">timingHint：{item.lifecycle?.timingHint ?? '-'}</div>
                    <div className="muted">transition：{item.lifecycle?.transitionLabel ?? '-'}{item.lifecycle?.changed ? '（本轮变化）' : ''}</div>
                    <div className="muted">transitionTone：{item.lifecycle?.transitionTone ?? '-'}</div>
                    <div className="muted">transitionPriority：{item.lifecycle?.transitionPriority ?? 0}</div>
                    <div className="muted">transitionReason：{item.lifecycle?.transitionReason ?? '-'}</div>
                    <div className="muted">feedback：{item.feedback?.label ?? 'NO_SIGNAL'} · {item.feedback?.confidenceLabel ?? 'LOW'}{item.feedback?.reversalActive ? ' · reversal active' : ''}</div>
                    <div className="muted">feedback calibration：{item.feedback?.calibrationMode ?? '-'}{item.feedback?.fallbackDepth ? ` · fallback ${item.feedback.fallbackDepth}` : ''}</div>
                    <div className="muted">feedback combo：{item.feedback?.comboKey ?? '-'}</div>
                    <div className="muted">feedback note：{item.feedback?.copyNote ?? '-'}</div>
                    <div className="muted">weighted sample：{item.feedback?.weightedSampleSize ?? 0} · win {item.feedback?.weightedWinRate ?? item.feedback?.winRate ?? 0}% · fail {item.feedback?.weightedFailRate ?? item.feedback?.failRate ?? 0}%</div>
                    <div className="muted">stageSince：{item.lifecycle?.stageSinceAt ?? '-'}</div>
                  </div>
                  <div className="moonshot-detail-card">
                    <h4>Safety Detail</h4>
                    <div className="muted">provider：{item.safety?.provider ?? '-'}</div>
                    <div className="muted">verdict：{item.safety?.verdict ?? '-'}</div>
                    <div className="muted">reason：{item.safety?.reason ?? '-'}</div>
                    <div className="muted">configured：{item.safety?.meta?.configured ? 'YES' : 'NO'}</div>
                    <div className="muted">implemented：{item.safety?.meta?.implemented ? 'YES' : 'NO'}</div>
                    {item.safety?.meta?.target ? <div className="muted">target：{item.safety.meta.target}</div> : null}
                    <div className="moonshot-check-list">
                      {(item.safety?.checks ?? []).map((check) => (
                        <div key={check.key} className={`moonshot-check-item ${check.passed ? 'pos' : 'neg'}`}>{check.passed ? '✓' : '✕'} {check.key} · {check.message}</div>
                      ))}
                    </div>
                  </div>
                  <div className="moonshot-detail-card">
                    <h4>RAVE-like Detail</h4>
                    <div className="muted">label：{item.raveLike?.label ?? '-'}</div>
                    <div className="muted">score：{item.raveLike?.total ?? 0}</div>
                    <div className="moonshot-check-list">
                      {Object.entries(item.raveLike?.parts ?? {}).map(([key, value]) => (
                        <div key={key} className="moonshot-check-item">{key} · {Number(value).toFixed(2)}</div>
                      ))}
                    </div>
                  </div>
                  <div className="moonshot-detail-card">
                    <h4>Score Detail</h4>
                    <div className="muted">Moon Score：{item.score?.total ?? 0}</div>
                    <div className="moonshot-check-list">
                      {Object.entries(item.score?.parts ?? {}).map(([key, value]) => (
                        <div key={key} className="moonshot-check-item">+ {key} · {Number(value).toFixed(2)}</div>
                      ))}
                      {Object.entries(item.score?.penalties ?? {}).filter(([, value]) => Number(value) > 0).map(([key, value]) => (
                        <div key={key} className="moonshot-check-item neg">- {key} · {Number(value).toFixed(2)}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        {!visible.length ? <div className="muted">当前没有符合条件的 moonshot 候选，可能是本轮扫描为空或条件较严格。</div> : null}
      </div>
    </div>
  )
}
