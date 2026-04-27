import type { AlertEvent } from '../types'

export type NotifierSendResult = {
  ok: boolean
  provider: string
  message?: string
}

export type Notifier = {
  id: string
  send: (alert: AlertEvent) => Promise<NotifierSendResult>
}

export function formatAlertForRelay(alert: AlertEvent) {
  return `${alert.title}\n\n${alert.body}`
}

export function createNoopNotifier(id = 'noop'): Notifier {
  return {
    id,
    async send() {
      return { ok: true, provider: id, message: 'noop' }
    },
  }
}
