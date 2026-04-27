import type { DashboardSettings } from '../types'

const traderPresets: Record<string, Partial<DashboardSettings>> = {
  AGGRESSIVE: {
    traderTimeZone: 'Asia/Shanghai',
    traderDayStartHour: 8,
    traderNightStartHour: 23,
    digestLiveOkDayWindowSec: 60,
    digestLiveOkNightWindowSec: 120,
    digestLiveSmallDayWindowSec: 180,
    digestLiveSmallNightWindowSec: 480,
    traderDayImmediateLiveOk: true,
    traderNightImmediateLiveOk: true,
  },
  BALANCED: {
    traderTimeZone: 'Asia/Shanghai',
    traderDayStartHour: 8,
    traderNightStartHour: 23,
    digestLiveOkDayWindowSec: 90,
    digestLiveOkNightWindowSec: 180,
    digestLiveSmallDayWindowSec: 300,
    digestLiveSmallNightWindowSec: 720,
    traderDayImmediateLiveOk: true,
    traderNightImmediateLiveOk: false,
  },
  NIGHT_SILENT: {
    traderTimeZone: 'Asia/Shanghai',
    traderDayStartHour: 8,
    traderNightStartHour: 23,
    digestLiveOkDayWindowSec: 120,
    digestLiveOkNightWindowSec: 480,
    digestLiveSmallDayWindowSec: 480,
    digestLiveSmallNightWindowSec: 1800,
    traderDayImmediateLiveOk: true,
    traderNightImmediateLiveOk: false,
  },
}

export function SettingsPanel({
  settings,
  onChange
}: {
  settings: DashboardSettings
  onChange: (next: DashboardSettings) => void
}) {
  return (
    <div className="card">
      <div className="panel-header">
        <h3>参数面板</h3>
        <div className="tag-row">
          <button className="ghost-btn small-btn" onClick={() => onChange({ ...settings, ...traderPresets.AGGRESSIVE })}>Trader：激进</button>
          <button className="ghost-btn small-btn" onClick={() => onChange({ ...settings, ...traderPresets.BALANCED })}>Trader：平衡</button>
          <button className="ghost-btn small-btn" onClick={() => onChange({ ...settings, ...traderPresets.NIGHT_SILENT })}>Trader：夜间静默</button>
        </div>
      </div>
      <div className="grid two">
        <label>
          超卖阈值（MA20 偏离 %）
          <input
            type="number"
            step="0.5"
            value={settings.oversoldThreshold}
            onChange={(e) => onChange({ ...settings, oversoldThreshold: Number(e.target.value) })}
          />
        </label>
        <label>
          趋势阈值（MA20 偏离 %）
          <input
            type="number"
            step="0.5"
            value={settings.trendThreshold}
            onChange={(e) => onChange({ ...settings, trendThreshold: Number(e.target.value) })}
          />
        </label>
        <label>
          极端波动阈值
          <input
            type="number"
            step="0.5"
            value={settings.extremeVolatilityThreshold}
            onChange={(e) => onChange({ ...settings, extremeVolatilityThreshold: Number(e.target.value) })}
          />
        </label>
        <label>
          单笔风险 %
          <input
            type="number"
            step="0.1"
            value={settings.perTradeRiskPct}
            onChange={(e) => onChange({ ...settings, perTradeRiskPct: Number(e.target.value) })}
          />
        </label>
        <label>
          默认杠杆
          <input
            type="number"
            step="1"
            value={settings.leverage}
            onChange={(e) => onChange({ ...settings, leverage: Number(e.target.value) })}
          />
        </label>
        <label>
          Account Equity / Base Capital
          <input
            type="number"
            step="100"
            value={settings.accountEquity}
            onChange={(e) => onChange({ ...settings, accountEquity: Number(e.target.value) })}
          />
        </label>
        <label>
          Sizing 基准
          <select
            value={settings.sizingMode}
            onChange={(e) => onChange({ ...settings, sizingMode: e.target.value as DashboardSettings['sizingMode'] })}
          >
            <option value="PAPER_FLOATING_EQUITY">跟随 Floating Equity（已实现+未实现）</option>
            <option value="PAPER_EQUITY">跟随 Paper Equity（仅已实现）</option>
            <option value="FIXED_CAPITAL">固定 Base Capital</option>
          </select>
        </label>
        <label>
          Risk Soft Cap ($)
          <input
            type="number"
            step="5"
            value={settings.riskSoftCapUsd}
            onChange={(e) => onChange({ ...settings, riskSoftCapUsd: Number(e.target.value) })}
          />
        </label>
        <label>
          Risk Hard Cap ($)
          <input
            type="number"
            step="5"
            value={settings.riskHardCapUsd}
            onChange={(e) => onChange({ ...settings, riskHardCapUsd: Number(e.target.value) })}
          />
        </label>
        <label>
          Max Concurrent Risk ($)
          <input
            type="number"
            step="10"
            value={settings.maxConcurrentRiskUsd}
            onChange={(e) => onChange({ ...settings, maxConcurrentRiskUsd: Number(e.target.value) })}
          />
        </label>
        <label>
          Trader Timezone
          <input
            type="text"
            value={settings.traderTimeZone}
            onChange={(e) => onChange({ ...settings, traderTimeZone: e.target.value || 'Asia/Shanghai' })}
          />
        </label>
        <label>
          Day Start Hour
          <input
            type="number"
            min="0"
            max="23"
            step="1"
            value={settings.traderDayStartHour}
            onChange={(e) => onChange({ ...settings, traderDayStartHour: Number(e.target.value) })}
          />
        </label>
        <label>
          Night Start Hour
          <input
            type="number"
            min="0"
            max="23"
            step="1"
            value={settings.traderNightStartHour}
            onChange={(e) => onChange({ ...settings, traderNightStartHour: Number(e.target.value) })}
          />
        </label>
        <label>
          LIVE_OK Day Digest (sec)
          <input
            type="number"
            min="0"
            step="10"
            value={settings.digestLiveOkDayWindowSec}
            onChange={(e) => onChange({ ...settings, digestLiveOkDayWindowSec: Number(e.target.value) })}
          />
        </label>
        <label>
          LIVE_OK Night Digest (sec)
          <input
            type="number"
            min="0"
            step="10"
            value={settings.digestLiveOkNightWindowSec}
            onChange={(e) => onChange({ ...settings, digestLiveOkNightWindowSec: Number(e.target.value) })}
          />
        </label>
        <label>
          LIVE_SMALL Day Digest (sec)
          <input
            type="number"
            min="0"
            step="10"
            value={settings.digestLiveSmallDayWindowSec}
            onChange={(e) => onChange({ ...settings, digestLiveSmallDayWindowSec: Number(e.target.value) })}
          />
        </label>
        <label>
          LIVE_SMALL Night Digest (sec)
          <input
            type="number"
            min="0"
            step="10"
            value={settings.digestLiveSmallNightWindowSec}
            onChange={(e) => onChange({ ...settings, digestLiveSmallNightWindowSec: Number(e.target.value) })}
          />
        </label>
        <label>
          Day Immediate LIVE_OK
          <select
            value={settings.traderDayImmediateLiveOk ? 'true' : 'false'}
            onChange={(e) => onChange({ ...settings, traderDayImmediateLiveOk: e.target.value === 'true' })}
          >
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </label>
        <label>
          Night Immediate LIVE_OK
          <select
            value={settings.traderNightImmediateLiveOk ? 'true' : 'false'}
            onChange={(e) => onChange({ ...settings, traderNightImmediateLiveOk: e.target.value === 'true' })}
          >
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </label>
      </div>
      <p className="muted">参数会保存在浏览器 localStorage 里，适合做轻量实验和规则微调。</p>
    </div>
  )
}
