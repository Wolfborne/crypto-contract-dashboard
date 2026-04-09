# MVP 收口清单（Option B：人工辅助下单驾驶舱）

## 分支
- `mvp/option-b-assisted-trading-cockpit`

## 一句话定义
把当前项目收口为一个**人工辅助下单的交易驾驶舱 MVP**：

> 市场数据 → 信号 → readiness → 风险过滤 → 飞书提醒 → 人工打开 dashboard → 30 秒内判断要不要做一笔小仓单。

这版 **不做自动下单**，也不再继续扩成“大而全”的研究平台。

---

## 目标
在 **半天到一天** 内，基于现有代码完成一个真实可用的 MVP，让它至少能稳定承担这 4 件事：

1. 看机会：候选信号、top candidates、why now
2. 看可做性：readiness / risk mode / cooldown / 降级原因
3. 收提醒：飞书收到少量高价值 alert
4. 做决策：人工据此做一次小仓辅助下单

---

## 收口原则

### 只做会影响“能不能日常使用”的事
优先修主链路，不做锦上添花。

### 统一产品定位
- 是：人工辅助下单驾驶舱
- 不是：自动交易系统
- 不是：完整策略研究平台
- 不是：多通道消息中心

### 能复用现有代码就不重写
优先复用：
- readiness
- alert queue
- digest buffer
- Feishu notifier
- risk mode / cooldown
- 当前 dashboard 面板

---

# P0（今天必须收口完成）

## P0-1. 明确并固定 MVP 主链路
**目标**：把项目定位写清楚，避免后面继续乱扩。

### 要做
- 更新 `README.md`
- 把当前版本定义为：
  - 人工辅助下单 dashboard MVP
  - 用于小仓试单 / 人工判断
  - 不包含自动下单
- 补一句 operator promise：
  - “收到 alert 后，用户打开 dashboard，可在 30 秒内判断这单是否值得做。”

### 验收
- 新人读 README，能一眼明白项目干什么、不干什么

---

## P0-2. 统一“正式推送链路”
**目标**：只认一条正式发送链路，避免维护双轨。

### 决策
- **正式链路：app-native Feishu webhook notifier**
- heartbeat sender：保留为临时/兼容/兜底路径，但不再作为产品主叙事

### 要做
- 检查 `src/server/index.mjs` 中 notifier 流程
- 确认 `/api/notifier/test-send` 可用
- 在 README / runbook 中明确：
  - 正式推送依赖 `FEISHU_WEBHOOK_URL` 或 `LARK_WEBHOOK_URL`
  - alert queue 的状态机含义：`PENDING / FAILED / SENT / ACKED`
- 若 UI 文案中还在强调“下一步再接飞书自动推送”之类过时描述，改掉

### 验收
- 项目文档、代码叙事、UI 叙事都一致：主链路就是 app-native Feishu notifier

---

## P0-3. 首页信息层级收口成“决策视图”
**目标**：打开 dashboard 后 30 秒内能完成一次人工判断。

### 要做
梳理首页最重要的信息顺序，优先保证以下内容同屏或近距离可见：

1. **当前风险状态**
   - riskMode
   - day/week loss guardrail
   - 是否 RISK_OFF / HARD_STOP

2. **Top candidates / SignalTable**
   - symbol
   - strategy
   - environment
   - readiness
   - why now

3. **单个机会的可执行信息**
   - entry
   - stop loss
   - take profit
   - 建议风险金额
   - 名义仓位
   - executionStatus
   - matchReason

4. **readiness 解释**
   - 为什么只能观察 / 纸上 / 小仓 / 可下注
   - 是否在 cooldown / downgrade

### 具体动作
- 减少“研究型/展示型”模块对首页决策流的打断
- 如果某些 panel 信息量太大但不影响下单决策，可以下沉或弱化视觉优先级
- 为当前 alert/readiness 的信息呈现补一个更直接的小结区（哪怕只是一个简洁 summary block）

### 验收
- 你自己打开 dashboard，30 秒内能说出：
  - 现在能不能做单
  - 最值得看哪 1~2 个币
  - 如果做，应该是观察 / 纸上 / 小仓 / 正常

---

## P0-4. 告警只保留高价值类型，减少噪音
**目标**：让飞书提醒变得“值得看”，而不是“什么都发”。

### 要做
- 只把以下类型视为 MVP 正式推送：
  - `LIVE_OK`
  - `LIVE_SMALL`
  - `RISK_ALERT`
- 检查 `emitAlertsFromSnapshot()` 当前生成规则是否过宽
- 检查 signature 去重规则是否足够稳，避免重复刷同一机会
- 调整 digest 逻辑，使 `LIVE_SMALL` 更克制、`RISK_ALERT` 更及时

### 推荐策略
- `RISK_ALERT`：立即发
- `LIVE_OK`：尽量短窗口 digest 或直接发
- `LIVE_SMALL`：buffer + digest，减少刷屏

### 验收
- 连续运行一段时间后，提醒数量不离谱
- 同一机会不会反复刷飞书
- 风险类提醒不会被 digest 拖太久

---

## P0-5. 告警状态可观测、可排查
**目标**：发不出去时，你能第一时间知道卡在哪。

### 要做
- 确认 UI 中以下信息可见：
  - 最近 delivery log
  - retrying items
  - digest buffer items
  - sent / failed / acked 数量
- 检查 queue summary 的接口与前端展示是否一致
- 对失败状态补清晰文案（例如 webhook 缺失、http status、cooldown active）

### 验收
- 任何一条 alert 没发到飞书时，可以通过 dashboard 快速定位原因

---

## P0-6. 做一轮 MVP 冒烟验证
**目标**：今天收口不是“代码看起来可以”，而是链路真的能跑。

### 要做
按下面顺序人工验证：

1. 启动前后端
2. dashboard 正常打开
3. runtime 数据正常刷新
4. 可以看到 signal / readiness / risk 状态
5. 调用 test-send 或触发真实 alert
6. 飞书收到消息
7. dashboard 能看到 sent / failed / acked / retry 变化
8. digest flush 正常

### 验收产物
- 在 repo 里追加一段简短的 “MVP smoke test result” 记录到 `runbook.md` 或新建 `mvp-smoke-test.md`

---

# P1（今天能补就补，补了体验会明显更像产品）

## P1-1. 增加“今日操作建议 / 今日只做什么”区域
**目标**：从信息展示升级到行动建议。

### 要做
在首页加一个轻量 summary 区：
- 当前风险模式
- 今日建议：
  - 只观察
  - 只做 paper
  - 允许 1 笔小仓
  - 允许正常跟进
- 当前最值得看的 1~2 个 symbol

### 验收
- 打开 dashboard，先看 summary 就能知道今天操作基调

---

## P1-2. 把 alert 文案收成“真能辅助下单”的格式
**目标**：飞书里一眼看出关键信息。

### 要做
统一 alert 文案模板，保证始终包含：
- 标的
- readiness / live status
- strategy / environment
- entry / stop / tp
- 建议风险 / 名义仓位
- why now / 中文说明

### 可选优化
- 精简换行和字段顺序
- 第一屏先给结论，再给细节

### 验收
- 在飞书里不点开 dashboard，也能先完成一次初筛

---

## P1-3. 首页弱化非 MVP 研究模块
**目标**：减少“能看很多，但不知道该做啥”的感觉。

### 要做
- 降低以下区域的默认视觉权重：
  - 深度研究/历史报告
  - 非当下决策必要的统计
  - 大段说明性文案
- 把“交易当下”相关区域放前面

### 验收
- 首页更像 cockpit，不像研究试验场

---

## P1-4. 明确一份人工辅助下单 SOP
**目标**：让 MVP 不只是“有信息”，而是“有用法”。

### 要做
在 `runbook.md` 追加一节：

建议格式：
1. 收到 `RISK_ALERT` → 暂停新增风险
2. 收到 `LIVE_SMALL` → 只允许小仓，且需人工复核 entry/stop
3. 收到 `LIVE_OK` → 仍需人工确认结构完整、RR 合格、无风险熔断
4. 若 dashboard 显示 cooldown / downgrade → 不放大仓位
5. 一次只跟 1~2 个最高质量机会

### 验收
- 别人拿到 runbook 就知道怎么用，不会误以为这是自动下单器

---

# P2（明确先不做，避免返工和失控）

## P2-1. 自动下单 / 交易所 API 接入
- 不做
- 原因：风险和工程复杂度都太高，会直接打爆这次 MVP 收口范围

## P2-2. 高级回测/统计验证继续扩写
- 不做
- 原因：会让项目继续停在研究态

## P2-3. 飞书卡片消息 / 多渠道推送
- 不做
- 原因：文本 alert 已够 MVP 使用

## P2-4. 多账户 / 多用户 / 权限系统
- 不做
- 原因：当前是单人自用产品

## P2-5. 大规模 UI 美化重构
- 不做
- 原因：现阶段优先让链路稳定和可判断

---

# 推荐执行顺序（半天到一天）

## 第 1 阶段：1~2 小时
- [ ] P0-1 更新 README，冻结产品定义
- [ ] P0-2 统一正式推送链路叙事
- [ ] P0-4 收紧 alert 策略，先把噪音压住

## 第 2 阶段：2~4 小时
- [ ] P0-3 首页信息层级收口成决策视图
- [ ] P0-5 检查 queue / log / retry / digest 可观测性
- [ ] P1-2 收 alert 文案

## 第 3 阶段：1~2 小时
- [ ] P1-1 增加“今日操作建议” summary 区
- [ ] P1-4 补 runbook 的人工辅助下单 SOP
- [ ] P0-6 做 MVP 冒烟验证并记录结果

---

# 开发时的判断标准
每做一个改动，都问自己一句：

> 这个改动，是否能让“收到 alert 后 30 秒内做出人工小仓决策”更容易？

如果答案不是明显的“是”，大概率就不该进这次 MVP 收口。

---

# 完成定义（Definition of Done）
满足以下条件即可宣布这轮收口完成：

- README 已明确项目定位
- 正式推送链路已统一
- Dashboard 首页已服务于“决策”而不是“展示”
- 飞书能收到高价值 alert
- queue / digest / retry / delivery log 可观测
- 有一份明确的人工辅助下单 SOP
- 做完一轮真实 smoke test

---

# 本轮建议不要犹豫的取舍
如果时间不够，优先保住：
- P0-2
- P0-3
- P0-4
- P0-6

宁可 UI 朴素，也别让主链路含糊。
