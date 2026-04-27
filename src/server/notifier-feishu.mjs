function alertWindowMs(alert) {
  if (alert?.kind === 'RISK_ALERT') return 4 * 60 * 60 * 1000
  if (alert?.kind === 'LIVE_SMALL') return 30 * 60 * 1000
  return 15 * 60 * 1000
}

function formatAlertTimeMeta(alert) {
  const createdAtTs = new Date(alert?.createdAt ?? 0).getTime()
  if (!Number.isFinite(createdAtTs)) return ''
  const now = Date.now()
  const diffMs = Math.max(0, now - createdAtTs)
  const diffMin = Math.floor(diffMs / 60000)
  const diffLabel = diffMin < 1 ? '刚刚' : diffMin < 60 ? `${diffMin}m 前` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h 前` : `${Math.floor(diffMin / 1440)}d 前`
  const windowMs = alertWindowMs(alert)
  const windowLabel = windowMs >= 3600000 ? `${Math.round(windowMs / 3600000)}h` : `${Math.round(windowMs / 60000)}m`
  const expired = diffMs > windowMs
  return `告警时间：${new Date(createdAtTs).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}
距今：${diffLabel}
有效窗口：${windowLabel}
当前状态：${expired ? '已过期，仅供复盘' : '当前有效'}`
}

export function createFeishuWebhookNotifier() {
  const webhook = process.env.FEISHU_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL

  return {
    id: 'feishu-webhook',
    enabled: Boolean(webhook),
    async send(alert) {
      if (!webhook) {
        return { ok: false, provider: 'feishu-webhook', message: 'missing webhook' }
      }

      const timeMeta = formatAlertTimeMeta(alert)
      const text = `[crypto]\n${alert.title}\n\n${timeMeta ? `${timeMeta}\n\n` : ''}${alert.body}`
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      })

      if (!res.ok) {
        return { ok: false, provider: 'feishu-webhook', message: `http ${res.status}` }
      }

      const data = await res.json().catch(() => ({}))
      const success = data?.StatusCode === 0 || data?.code === 0 || data?.msg === 'success' || data?.Extra === null || Object.keys(data ?? {}).length === 0
      return {
        ok: success,
        provider: 'feishu-webhook',
        message: success ? 'sent' : JSON.stringify(data),
      }
    },
  }
}
