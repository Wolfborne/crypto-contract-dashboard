# Crypto Contract Dashboard MVP

一个给自己用的 **crypto contract 人工辅助下单驾驶舱**。

## 这版是干什么的
它的目标不是自动交易，而是把下面这条链路收成一个可用 MVP：

> 市场数据 → 信号 → readiness → 风险过滤 → 飞书提醒 → 人工打开 dashboard → 30 秒内判断要不要做一笔小仓单

当前版本适合：
- 看市场状态与候选机会
- 看某个机会当前是 `LIVE_OK` / `LIVE_SMALL` / `PAPER_ONLY` / `NO_TRADE`
- 收到高价值提醒后，快速复核 entry / stop / tp / 风险预算
- 做 **人工确认后的小仓辅助下单**

当前版本不做：
- 自动下单
- 交易所 API 执行
- 多用户协作
- 大而全的研究平台继续扩展

## MVP 核心能力
- 候选信号与 Top Candidates
- readiness 分级与解释信息
- 风险模式：`NORMAL / RISK_OFF / HARD_STOP`
- 建议风险金额 / 名义仓位 / sizing caps
- Feishu 文本提醒
- 全链暴涨币雷达（Moonshot Radar，基于 DexScreener 多链候选扫描）
- alert queue 状态机：`PENDING / FAILED / SENT / ACKED`
- digest buffer / retry / delivery log

## 正式推送链路
正式推送链路已经收口为：

- **app-native Feishu webhook notifier**

依赖环境变量：
- `FEISHU_WEBHOOK_URL`
- 或 `LARK_WEBHOOK_URL`

建议做法：
- 复制 `.env.example` 为本地 `.env`
- 把真实 webhook URL 只放在 `.env` 或部署环境变量里
- 不要把任何真实 webhook / token 明文提交到仓库

说明：
- `RISK_ALERT` 走即时提醒
- `LIVE_OK` 走高优先级提醒
- `LIVE_SMALL` 更克制，优先缓冲成 digest

> heartbeat sender 可以作为兼容/兜底路径存在，但不是这版 MVP 的主链路。

## 运行
```bash
npm install
npm run dev
```

- 前端：`4173`
- 本地服务：`4174`

仅启动服务端：
```bash
npm run start:server
```

Moonshot Radar API：
```bash
curl http://localhost:4174/api/moonshot/candidates
```

## 操作承诺（Operator Promise）
如果这版 MVP 工作正常，那么当你收到一条飞书提醒后：

- 打开 dashboard
- 在 30 秒内看清：
  - 现在能不能新增风险
  - 最值得看哪 1~2 个币
  - 这是观察、paper、小仓，还是可下注
  - 如果做，entry / stop / tp / 风险预算分别是什么

## 已知限制
- 公共 API 数据质量和速率受上游限制影响
- readiness 与告警逻辑仍属于辅助决策，不是统计上完全验证的自动策略
- 有了提醒，也仍然需要人工复核结构、RR、风险预算和市场上下文
