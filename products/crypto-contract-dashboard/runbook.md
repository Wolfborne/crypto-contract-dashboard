# Crypto Contract Dashboard MVP Runbook

## Goal
Use one dashboard as a repeatable **assisted trading cockpit**: scan regime, shortlist setups, check readiness and risk state, receive Feishu alerts, then make a human decision on whether to place a small trade.

## Operator flow
1. Open the dashboard.
2. Read **今日操作建议** and confirm current `Risk Mode`.
3. Review the top candidates and their readiness / why-now reasons.
4. Confirm entry, stop, TP, and suggested risk / notional.
5. If the setup still makes sense, place the trade manually in small size.
6. After the trade, log / review the result and observe whether readiness gets downgraded.

## Guardrails
- Treat the dashboard as a decision aid, not an auto-trader.
- If external APIs fail, do not infer missing fields as valid signals.
- `RISK_OFF` means reduce risk; `HARD_STOP` means no new real-money exposure.
- Do not enlarge size when cooldown / downgrade is active.
- Prefer 1-2 highest-quality opportunities instead of chasing many alerts.

## Inputs
- Binance Futures market data
- CoinGecko market-cap and category data
- Alternative.me fear/greed
- User risk inputs
- Paper trades and readiness runtime state

## Outputs
- Market regime summary
- Decision cockpit and top candidates
- Readiness and risk-mode explanations
- Position sizing guidance
- Feishu alert delivery and queue visibility

## Feishu notifier operations
Official notifier path:
- app-native Feishu webhook notifier

Required env:
- `FEISHU_WEBHOOK_URL`
- or `LARK_WEBHOOK_URL`

Recommended secret handling:
- copy `.env.example` to local `.env`
- keep real webhook URLs only in `.env` or deployment env vars
- never commit real webhook / token values into git

Alert queue states:
- `PENDING`: waiting to be sent
- `FAILED`: send failed, or buffered / cooling down
- `SENT`: delivered by notifier
- `ACKED`: acknowledged / archived / absorbed into digest

Useful checks:
1. Use **测试发送** to verify Feishu connectivity.
2. Check **delivery log** if nothing arrives.
3. Check **retrying items** for next retry time and last error.
4. Check **digest buffer** if alerts are intentionally being grouped.

## 人工辅助下单 SOP
1. 收到 `RISK_ALERT`
   - 默认暂停新增风险
   - 先回 dashboard 看 `Risk Mode`、当日损益、本周损益、drawdown

2. 收到 `LIVE_SMALL`
   - 只允许小仓
   - 必须人工复核 entry / stop / TP / RR
   - 若有 cooldown / downgrade，不放大仓位

3. 收到 `LIVE_OK`
   - 仍需人工确认结构完整、why now 成立、没有熔断类风险约束
   - 一次优先只跟进 1 笔最高质量机会

4. 如果 dashboard 显示 `RISK_OFF`
   - 即便有机会，也默认更克制
   - 只接受最清晰、最标准的 setup

5. 如果 dashboard 显示 `HARD_STOP`
   - 不新增真钱单
   - 只做观察、复盘、风险处理

## MVP smoke test checklist
- [ ] 前端与服务端能正常启动
- [ ] Dashboard 能加载 snapshots / signals / readiness / risk mode
- [ ] 今日操作建议区域有内容
- [ ] Feishu 测试发送成功
- [ ] 告警状态在 queue / delivery log 中可见
- [ ] digest flush 能正常工作
- [ ] 打开 dashboard 后能在 30 秒内完成一次人工筛单

## Known limits
- Public APIs can rate-limit or return inconsistent fields.
- This is still a discretionary-assistance workflow, not an execution engine.
- Feishu alerts are text-first and optimized for clarity, not rich card UX.
