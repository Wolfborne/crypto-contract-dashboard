# MVP Smoke Test (current branch)

Branch:
- `mvp/option-b-assisted-trading-cockpit`

Date:
- 2026-04-09

## Automated / local dev checks completed
- [x] `npm run build`
- [x] TypeScript build passed
- [x] Vite production build passed
- [x] `npm run dev` successfully started
- [x] Frontend reachable at local dev port
- [x] Backend reachable at `http://localhost:4174/`
- [x] `/api/health` returns `ok: true`
- [x] `/api/notifier/status` returns valid JSON
- [x] `/api/notifier/queue-summary` returns valid JSON
- [x] `/api/alerts` returns valid JSON

## Real notifier checks completed
- [x] `FEISHU_WEBHOOK_URL` loaded successfully from shell environment
- [x] Feishu notifier status switched to `configured=true`, `enabled=true`
- [x] Real `POST /api/notifier/test-send` succeeded
- [x] Delivery log recorded successful send via `feishu-webhook`
- [x] Keyword-gated webhook compatibility verified via `[crypto]` prefix

## Real business-alert loop checks completed
- [x] Manually enqueued one `LIVE_SMALL` business alert
- [x] Alert entered queue successfully
- [x] Queue summary reflected current digest strategy (`LIVE_SMALL_ONLY`)
- [x] Alert moved into digest buffer instead of immediate send
- [x] Buffered item became visible in queue summary / digest items
- [x] UI adjusted so buffered alerts are shown as `BUFFERED（已进入摘要缓冲）`, not treated as real failures

## Current observed local state
- Feishu notifier: real webhook connected
- Queue summary can be queried normally
- Delivery log contains both:
  - historical failed attempt with `missing webhook`
  - successful real send after webhook configuration
- `LIVE_SMALL` alerts currently follow low-noise digest behavior during day mode

## UI / workflow checks completed by code + local boot validation
- [x] README 已收口到人工辅助下单 MVP 定位
- [x] Runbook 已加入人工辅助下单 SOP
- [x] Dashboard 顶部新增“今日操作建议 / 风险总览 / MVP 使用姿势”
- [x] 首页结构已进一步压成 cockpit：决策区在前，研究与配置区下沉到折叠区
- [x] Notifier 面板已退到第二优先级，用于排查 queue / retry / digest
- [x] 告警预览文案已统一为正式 Feishu webhook 主链路叙事
- [x] Alert 文案已调整为“先结论，再细节”的辅助下单格式
- [x] Alert 自动生成上限从 5 条收紧到 3 条

## Remaining manual / product checks
- [ ] 在浏览器实际确认 cockpit 首屏布局与折叠区体验
- [ ] 验证 digest 到时自动 flush 或手动 flush 的最终发送体验
- [ ] 验证收到提醒后，30 秒内可以完成一次人工筛单
- [ ] 根据真实使用反馈微调 digest / cooldown 参数

## Notes
- MVP 正式推送主链路已从“理论可用”升级到“真实可用”。
- 真实业务 alert 闭环也已跑通，但 `LIVE_SMALL` 当前按低噪音策略进入 digest buffer。
- 本轮未重构后端状态机，只通过 UI 呈现把 `buffered` 与真实 `failed` 语义分开。
