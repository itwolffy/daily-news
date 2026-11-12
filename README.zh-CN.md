# Daily News Bot

[English](README.md) | **简体中文**

一个面向个人长期使用的自动化新闻早报项目。项目通过 Vercel Cron 定时采集科技、人工智能、商业、金融和开发者社区新闻，使用 DeepSeek 将相关报道整理为结构化事件，最终通过 Telegram 推送简体中文早报。

项目重点不是单纯聚合新闻，而是尽量做到定时执行、来源可追溯、降低重复推送风险，并明确处理推送结果不确定的情况。

## 项目功能

- **多源采集**：并行采集 Hacker News、近期活跃 GitHub 仓库、36 氪、华尔街见闻、知乎、V2EX 及可配置的 RSS/Atom 订阅源。单个来源失败不会中断其他采集器。
- **新闻预处理与评分**：校验 HTTP(S) 链接，保留滚动 24 小时内的新闻，对规范化后的 URL 和标题去重，并根据来源权重、时效性、互动热度和内容完整度评分。
- **AI 事件聚合**：调用 DeepSeek，将同一底层事件的多篇报道合并，评估重要性，生成简体中文事实摘要、影响分析和后续观察点。
- **证据状态约束**：区分媒体报道、多来源报道、未经独立核实和分析判断。涉及个人指控或刑事等高风险内容时标记为“未经独立核实”。
- **来源可追溯**：模型返回的来源 ID 必须对应本次采集结果。最终展示的来源名称和 URL 使用采集器中的可信数据，不使用模型生成的链接。
- **本地降级**：未配置 DeepSeek Key、请求失败或模型输出未通过校验时，使用本地规则降级，最多展示 12 条符合中文要求的新闻；不执行 AI 跨来源事件聚合、分析和排序。
- **Telegram 推送**：对 HTML 内容进行转义，校验外发链接，并按完整内容块拆分消息，控制在 Telegram 单条消息 4096 字符限制以内。
- **可选 Redis 状态存储**：配置 Upstash Redis REST 后，可持久化每日任务状态、任务锁、推送进度和近期事件历史。不配置 Redis 也可以运行基础流程，无需额外部署 Redis 服务。
- **早报头部信息**：可展示天气、美元兑人民币汇率和比特币价格及 24 小时涨跌幅。各数据源独立获取，单个接口不可用不会影响其他信息。

## 新闻处理流程

```text
Vercel Cron
    |
    v
/api/cron —— 请求方法检查 + Bearer Token 认证
    |
    v
并行采集新闻
(Hacker News / GitHub / 36氪 / 华尔街见闻 / 知乎 / V2EX / RSS)
    |
    v
数据标准化 -> 链接校验 -> 滚动 24 小时窗口 -> 去重 -> 评分
    |
    v
DeepSeek AI 整理（失败时使用本地 Fallback）
    |
    v
校验来源 ID -> 映射回可信来源信息
    |
    v
生成 Telegram HTML -> 拆分消息 -> 逐条推送
    |
    v
保存已确认推送数量 -> 标记 sent -> 保存近期事件历史
                    （Redis 可选）
```

## 部署到 Vercel

### 环境要求

- Node.js 20 或更高版本
- 已关联本 GitHub 仓库的 Vercel 项目
- Telegram Bot 和接收早报的 Chat
- DeepSeek API Key（可选；未配置时使用本地 Fallback）

### 部署步骤

1. 将仓库导入 Vercel，完成首次部署。
2. 在 Vercel 项目的 **Settings → Environment Variables** 中配置下方环境变量。
3. 至少将必需变量添加到 **Production** 环境。
4. 修改环境变量后重新部署，使配置生效。
5. 在 Vercel 项目设置中确认 Cron 配置已生效。
6. 定时或手动运行后，进入 **Functions → Logs**，检查是否出现 `daily_news_completed` 日志。

Cron 表达式为 `0 1 * * *`，即每天 **01:00 UTC（北京时间 09:00）** 执行。

### 环境变量

#### 必需变量

| 变量 | 说明 |
| --- | --- |
| `CRON_SECRET` | Cron 接口访问密钥。请求必须携带 `Authorization: Bearer <CRON_SECRET>` 请求头。 |
| `TG_BOT_TOKEN` | Telegram Bot Token。 |
| `TG_CHAT_ID` | 接收早报的 Telegram Chat ID。 |

#### 可选变量

| 变量 | 默认值 / 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key。配置后启用 AI 整理；未配置时使用本地 Fallback。 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址，默认 `https://api.deepseek.com`。 |
| `DEEPSEEK_MODEL` | 模型名称，默认 `deepseek-chat`。 |
| `DEEPSEEK_TIMEOUT_MS` | DeepSeek 请求超时时间，单位为毫秒，默认 `30000`（30 秒）。 |
| `WEATHER_CITY` | 早报头部天气城市，默认香港。 |
| `WEATHER_LAT`、`WEATHER_LON` | 早报头部天气位置的经纬度，默认使用香港坐标。 |
| `NEWS_RSS_URLS` | 逗号分隔的 RSS/Atom URL。配置后会替换默认订阅源列表。 |
| `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | 可选的 Upstash Redis REST 配置。也支持兼容变量 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`。同一组 URL 和 Token 必须同时配置。 |
| `HTTP_TIMEOUT_MS` | 新闻采集器 HTTP 请求超时时间，单位为毫秒，默认 `8000`。 |

不要将密钥提交到 Git 仓库。生产环境请在 Vercel Environment Variables 中配置。

## 本地开发与测试

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

启动本地 Vercel 开发环境：

```bash
npm start
```

Cron 接口仅接受 **GET** 请求。本地手动调用示例：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

接口返回 JSON。其中 `ai_curated` 仅表示本次是否成功使用 AI 整理，不代表整个早报任务是否成功。

## 可靠性与推送语义

### Redis 是可选项

未配置 Redis 时，任务状态和锁使用进程内 Map。它只能防止同一个热启动 Serverless 实例内的重复执行，**不是分布式锁**，也无法跨实例或进程重启持久化；近期事件历史在此模式下不可用。

配置 Redis 后：

- 每日任务认领和锁所有权校验通过 Redis 原子脚本完成。
- 任务锁有效期为 2 小时，任务状态保留 2 天。
- 近期事件历史保留 14 天，最多保存 80 条。
- 更新和释放锁时会校验随机所有权 Token。

### Telegram 推送

- 消息按顺序逐条发送。
- 每成功收到 Telegram 对一条消息的确认，就持久化已确认的消息数量。
- Telegram 4xx 响应视为明确拒绝；HTTP 429 在要求等待时间不超过 10 秒时进行有限次数重试。
- 网络错误和服务端错误可能发生在 Telegram 已接收消息之后，推送结果因此无法确定。此类任务会标记为 `delivery_unknown`，不会自动重试。手动重试前应先检查目标 Telegram 聊天记录；Telegram `sendMessage` 不提供通用幂等键。
- 所有消息均确认发送成功后，任务先标记为 `sent`，再保存近期事件历史。历史写入失败不会因此重新发送当天早报。

这些机制用于降低重复推送风险，但不能保证所有基础设施故障场景下都实现严格的 Exactly-once 投递。

## 数据与内容限制

- 新闻主时间窗口为滚动 24 小时。缺少可靠时间戳的内容可能保留，但会受到排序评分惩罚，不会被直接视为已确认的新鲜新闻。
- GitHub 采集关注近期有推送活动的仓库，并按总 Star 数排序；不代表过去七天新增 Star 数。
- AI 摘要基于采集到的标题和摘要片段生成，项目不会声称已经读取新闻网页全文。
- Fallback 模式最多展示 12 条符合中文要求的新闻，不具备跨来源事件聚合、AI 分析和 AI 排序能力。
- 外部 API 和 RSS 源可能变化或不可用。单个采集器失败不会中断其他来源；若早报内容不完整，应检查 Vercel Function Logs 和采集器统计。

## 运行监控

每次成功运行后，可在 Vercel Function Logs 中查找结构化日志 `daily_news_completed`。

| 字段 | 含义 |
| --- | --- |
| `newsCount` | 预处理后的新闻数量 |
| `eventCount` | 整理后的事件数量 |
| `messageCount` | Telegram 推送消息条数 |
| `aiCurated` | 本次是否成功使用 AI 整理 |
| `redis` | 当前是否启用了 Redis 配置 |
| `collectorStats` | 各采集器的新闻数量和执行状态 |
| `durationMs` | 本次任务总耗时 |

## 安全机制

- Cron 接口仅接受 GET 请求，并要求 Bearer Token 认证。
- Token 比较使用常量时间比较。
- Telegram HTML 内容经过转义，外发链接仅允许 HTTP(S)。
- AI 输出经过结构校验，来源 ID 必须对应本次采集记录。
- 不向接口调用方返回上游原始错误或敏感凭据。
- 不要将 `CRON_SECRET`、Telegram 凭据、DeepSeek API Key 或 Redis Token 提交到 Git，也不要在日志中输出这些凭据。
