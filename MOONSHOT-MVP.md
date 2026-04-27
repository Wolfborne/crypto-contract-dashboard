# 全链暴涨币雷达 MVP（RAVE 参照版）

## 目标

在现有 `crypto-contract-dashboard` 上，补一条新的轻量链路：

> 全链候选发现 → 异动评分 → 低噪音告警 → 飞书提醒 / API 可查

它不是自动交易器，也不是完整 alpha 引擎；这版先解决 **“尽量更早发现像 RAVE 这种起飞中的币”**。

---

## 为什么拿 RAVE 当参照

基于当前可抓到的 DexScreener 数据，RAVE（Base / Aerodrome 主池）在这波里至少呈现了这些可量化特征：

- 链：Base
- 主要池：RAVE / USDC
- 流动性：约 `$472k`
- 24h 成交额：约 `$3.35m`
- 6h 成交额：约 `$726k`
- 1h 成交额：约 `$190k`
- 1h 交易数：约 `1,551`
- 6h / 24h 价格变化：`-17.56% / -24.02%`（抓取时点已是回撤段）

可见，**真正值得盯的不是“已经涨了多少”本身，而是：**

1. 足够深的流动性，不是纯小池对敲
2. 成交额在短周期内显著放大
3. 交易笔数快速抬升
4. 社交 / profile / boost 等外部注意力同步出现
5. 新老池都可能爆，但新池更需要额外风控过滤

所以 MVP 的核心思路是：

- 不做价格预测
- 只做 **异动雷达 / 早期候选筛选**
- 优先捕捉“正在放量 + 有流动性 + 有交易活跃度”的币

---

## 本版数据源

### 已接入
- `DexScreener token-boosts/latest`
- `DexScreener token-boosts/top`
- `DexScreener token-profiles/latest`
- `DexScreener latest/dex/tokens/:tokenAddress`

### 为什么这样选
这些源的组合足够做 MVP：

- `boosts`：拿到“被推 / 被关注”的种子集合
- `profiles`：拿到带社交链接的种子集合
- `tokens/:address`：拿到真正可评分的 pair 行情、流动性、成交额、交易数

这比一开始就接几十个链上 indexer 要轻很多，也更适合先验证告警价值。

---

## Moon Score 因子

当前评分是启发式，不是回测过的统计模型。

另外已加入一个独立的 **RAVE-like 模板分**：
- 深流动性
- 强 1h 成交额
- 强 1h 交易活跃度
- 可信 quote
- breakout / acceleration
- 避免过于末端的 24h 涨幅

它不是替代 Moon Score，而是回答：
**“这个币的形状，像不像 RAVE 这类值得重点看的爆发候选？”**

### 加分项
- 流动性（Liquidity）
- 1h / 6h 成交额（Volume）
- 5m / 1h 交易活跃度（Txns）
- 5m / 1h / 6h 价格动量（Momentum）
- 5m 成交加速度（Acceleration）
- 24h 持续性（Persistence）
- 社交 / profile 信号（Socials）
- Dex boost 金额（Boost）
- 新鲜度（Freshness）

### 扣分项
- 流动性过低
- 1h 成交额过低
- 交易活跃度太弱
- 已经过度拉升
- 微型池 / 易失真池

### 分级
- `WATCH`
- `HOT`
- `EXTREME`

当前只有 `HOT / EXTREME` 会进入 alert 候选。

---

## 当前实现内容

### 安全检查接口（可插拔）
当前已预留 `runSafetyChecks()`，默认使用本地 heuristic：
- trusted quote
- min liquidity
- name sanity

并支持 provider 骨架：
- `MOONSHOT_SAFETY_PROVIDER=local-heuristic`（当前默认）
- `MOONSHOT_SAFETY_PROVIDER=goplus`（当前已接入真实请求骨架与部分字段映射：cannot_buy / cannot_sell_all / honeypot / tax / blacklist / mintable / hidden_owner）
- 未来可替换为其他 provider

后续可无缝替换 / 扩展为：
- GoPlus
- honeypot
- sellability
- tax / owner / blacklist 风险

### 新增服务端模块
- `src/server/moonshot-scanner.mjs`

负责：
- 全链种子抓取
- 去重
- 主交易对选择
- Moon Score 评分
- 构造 moonshot alerts

### 接入现有 runtime
在 `src/server/index.mjs` 中：
- 每次 runtime refresh 时同步刷新 `moonshotRadar`
- 写入 `runtime-state.json`
- 自动把 `moonshotRadar.alerts` 接入现有 `appendAlerts()` 链路

### 新增 API
- `GET /api/moonshot/candidates`

可直接查看当前扫描结果：
- `scannedAt`
- `sources`
- `candidates`
- `alerts`

---

## 告警格式

当前支持两段式提醒：
- `EARLY`：第一次进入 HOT / 初次显著异动
- `CONFIRM`：后续几轮扫描继续增强（例如 breakout / sustained / volume ratio 抬升）

标题：
- `[暴涨雷达 / HOT] SYMBOL (chain)`
- `[暴涨雷达 / EXTREME] SYMBOL (chain)`

正文包含：
- 链 / DEX
- 价格
- Moon Score
- 1h / 6h / 24h 涨跌
- 5m / 1h / 24h 成交额
- 5m / 1h 交易数
- 流动性
- FDV
- Age
- 触发因子
- DexScreener 链接

它不是“建议直接下单”，而是“你应该现在看一眼”。

---

## 这版 MVP 的局限

1. 仍偏 **DexScreener 驱动**，不是原始链上 indexer
2. 交易数不是 unique buyers，暂时只能先用 `buys + sells`
3. 还没接 honeypot / tax / sellability 风险过滤
4. 还没做历史窗口缓存与回测
5. 还没把 Moon Score 画进 dashboard UI（目前先走 runtime + alert + API）

---

## 下一步最值得补的 3 个点

### P1：风险过滤
当前已让 safety 参与结果：
- safety hard block → 直接过滤掉候选
- safety caution → 降级 EXTREME，且弱候选不进入列表
- 排序优先让 safety PASS 的候选靠前

下一步继续补：
- GoPlus 更完整字段映射
- Honeypot / sellability 更精细规则
- tax / blacklist / owner risk 分层处置

### P1：历史窗口
已做第一版 token 历史快照缓存，当前会：
- 把候选写入 `data-runtime/moonshot-history.json`
- 计算 score delta / volume 1h ratio / txns 1h ratio
- 标记 breakout
- 支持告警升级（HOT → EXTREME）

下一步可继续补：
- 更长窗口（5m → 15m → 1h → 6h）
- 更细的持续性评分
- 已做基础降级/冷却逻辑：进入 cooldown 后不重复提醒，回落到 WATCH/弱分数后 rearm，再次转强才重报

### P1：前端展示
已在 dashboard 增加 Moonshot 面板，并支持：
- chain / score / volume / liquidity / age
- RAVE-like / Safety 摘要
- 双视图：预警池 / 精选池
- 候选状态演化：NEW / HEATING / CONFIRMED / COOLING
- 状态迁移展示：例如 NEW → HEATING / HEATING → CONFIRMED
- 状态迁移型提醒：NEW → HEATING、HEATING → CONFIRMED、CONFIRMED → COOLING 会单独触发告警
- 迁移提醒优先级细化：结合 Safety / breakout / sustained scans / score，把迁移提醒区分为 ACTION / WATCH / RISK
- 前端显式展示迁移判定原因：直接说明为什么是 ACTION / WATCH / RISK
- 决策短句：把迁移判断压缩成更适合首屏扫读的一句话（如“可优先复核 / 先观察 / 谨慎”）
- 池子语义统一：ACTION 更偏精选池，WATCH 更偏预警池，强风险迁移进入风险池
- UI 语义化：不同池子用不同卡片视觉与说明文案，首屏阅读感直接区分“行动 / 观察 / 风险”模式
- 操作提示板：不同池子显示不同的使用建议，每张卡片也给出建议动作短提示
- 时机建议：给出“现在复核 / 等下一轮扫描 / 短期先观察风险”的时间维度提示
- 执行等级：增加 A / B / C / R 段位，用于区分现在就看、重点关注、观察名单、风险观察
- 总览统计：summary 与最近提醒都显示 A / B / C / R 分布，帮助判断当前整体偏进攻还是偏风险
- 市场节奏结论：根据执行等级、池子分布、tone 分布，直接给出当前偏进攻 / 偏观察 / 偏防守的一句话判断
- 更细风险分层：Safety verdict 拆成 PASS / WARN / DOWNGRADE / BLOCK
- 默认支持更贴近实盘的 priority 排序（tone + Safety + pool category + 生命周期 + 迁移变化 + RAVE-like + Score）
- 展开详情：score parts / penalties / RAVE-like parts / safety checks
- 高质量模式开关（Safety PASS + RAVE-like / Moon Score 达标）
- 一键跳 DexScreener

---

## 操作预期

如果这版工作正常：

- 后端会持续扫描全链候选
- safety 不佳的候选会被过滤或降级，不再和高质量候选混在一起
- 现有 Feishu 告警链路会收到更克制的 `HOT / EXTREME` 异动提醒
- 你也可以直接查 `/api/moonshot/candidates`
- 这样至少能把“像 RAVE 这种正在起飞或刚起飞的币”更早送到你眼前
