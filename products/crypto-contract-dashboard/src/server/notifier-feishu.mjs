export function createFeishuWebhookNotifier() {
  const webhook = process.env.FEISHU_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL

  return {
    id: 'feishu-webhook',
    enabled: Boolean(webhook),
    async send(alert) {
      if (!webhook) {
        return { ok: false, provider: 'feishu-webhook', message: 'missing webhook' }
      }

      const text = `[crypto]\n${alert.title}\n\n${alert.body}`
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
