# Daily News Bot

[English](README.md) | **简体中文**

一个面向个人长期使用的自动化新闻早报项目。项目通过 Vercel Cron 定时采集科技、人工智能、商业、金融和开发者社区新闻，使用 DeepSeek 进行事件聚合与中文整理，最终通过 Telegram 推送。

## 项目功能

- **多源采集**：并行采集 Hacker News、近期活跃 GitHub 仓库、36 氪、华尔街见闻、知乎、V2EX 及 RSS/Atom 订阅源。
- **新闻预处理**：统一数据结构，校验 HTTP(S) 链接，保留滚动 24 小时内的新闻，对 URL 和标题去重，并根据来源质量、发布时间、热度和内容完整度评分。
- **AI 事件聚合**：调用 DeepSeek，将同一事件的多篇报道合并，评估重要性，生成简体中文事实摘要、影响分析和后续观察点。
- **来源可追溯**：模型返回的来源 ID 必须能在本次采集结果中找到。最终来源名称和 URL 使用采集器中的可信数据，不使用模型生成的链接。
- **本地降级**：未配置 DeepSeek Key、请求失败或模型输出未通过校验时，使用本地规则进行 Fallback。降级模式仅保留符合中文内容要求的新闻，不执行 AI 跨来源事件聚合和深度分析。
- **Telegram 推送**：对 HTML 内容进行转义，并按完整 HTML 块拆分消息，避免超过 Telegram 单条消息 4096 字符的限制。
- **可选 Redis 状态存储**：配置 Upstash Redis REST 后，可持久化每日任务锁、推送进度和近期事件历史；不需要额外部署 Redis 服务。

## 新闻处理流程

```text
Vercel Cron
    |
    v
/api/cron —— 请求认证
    |
    v
并行采集新闻
(Hacker News / GitHub / 36氪 / 华尔街见闻 / 知乎 / V2EX / RSS)
    |
    v
数据标准化 -> 链接校验 -> 24 小时时间窗口 -> 去重 -> 评分
    |
    v
DeepSeek AI 整理（失败时使用本地 Fallback）
    |
    v
校验来源 ID，并映射回可信来源信息
    |
    v
生成 Telegram HTML -> 拆分消息 -> 推送
    |
    v
保存推送进度和近期事件历史（Redis 可选）
```

### AI 失败时的降级行为

如果没有配置 `DEEPSEEK_API_KEY`、DeepSeek 请求失败，或模型输出未通过校验，系统会使用本地 Fallback：

- 仅保留符合中文内容要求的新闻；
- 最多展示 12 条；
- 不进行 AI 跨来源事件聚合和深度分析；
- 如果没有符合条件的中文新闻，会发送中文提示。

接口返回的 `ai_curated` 字段表示本次是否成功使用 AI 整理：`true` 表示成功，`false` 表示使用了 Fallback。它与整个任务是否成功是两个不同状态。

## 部署到 Vercel

### 环境要求

- Node.js 20 或更高版本
- Vercel 项目，并关联本 GitHub 仓库
- Telegram Bot 和接收早报的 Chat
- DeepSeek API Key（可选；未配置时使用本地 Fallback）

### 部署步骤

1. 将仓库导入 Vercel 并完成首次部署。
2. 在 Vercel 项目的 **Settings → Environment Variables** 中配置环境变量。
3. 确认变量已添加到 **Production** 环境，然后重新部署，使变量生效。
4. 在 Vercel 项目设置中确认 Cron 配置已生效。
5. 运行后进入 **Functions → Logs**，检查是否出现 `daily_news_completed` 日志。

Cron 配置为 `0 1 * * *`，即每天 **01:00 UTC（北京时间 09:00）** 执行。

### 环境变量

#### 必需变量

| 变量 | 说明 |
| --- | --- |
| `CRON_SECRET` | Cron 接口访问密钥，设置为足够长的随机字符串。Vercel Cron 使用 `Authorization: Bearer <CRON_SECRET>` 请求接口；手动调用也必须携带相同请求头。 |
| `TG_BOT_TOKEN` | Telegram Bot Token。 |
| `TG_CHAT_ID` | 接收早报的 Telegram Chat ID。 |

#### 可选变量

| 变量 | 默认值 / 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key。配置后启用 AI 整理；未配置时使用本地 Fallback。 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址，默认 `https://api.deepseek.com`。 |
| `DEEPSEEK_MODEL` | 模型名称，默认 `deepseek-chat`。 |
| `DEEPSEEK_TIMEOUT_MS` | DeepSeek 请求超时时间，单位为毫秒，默认 `30000`（30 秒）。例如 35 秒填写 `35000`，不要填写 `35`。 |
| `WEATHER_CITY` | 早报头部天气城市，默认香港。 |
| `WEATHER_LAT`、`WEATHER_LON` | 早报头部天气位置的经纬度。 |
| `NEWS_RSS_URLS` | 逗号分隔的 RSS/Atom URL。配置后会替换默认订阅源列表。 |
| `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | 可选的 Upstash Redis REST 配置。也支持兼容变量 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`。URL 和 Token 需要同时配置。 |
| `HTTP_TIMEOUT_MS` | 新闻采集器 HTTP 请求超时时间，单位为毫秒，默认 `8000`。 |

不要将上述密钥提交到 Git 仓库。生产环境请在 Vercel Environment Variables 中配置。

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

Cron 接口仅接受 **GET** 请求。本地手动调用时，访问 `/api/cron` 并携带请求头：

```http
GET /api/cron
Authorization: Bearer <CRON_SECRET>
```

## 可靠性与运行说明

- **Redis 是可选项。** 未配置 Redis 时，任务状态和锁使用进程内 Map。它只能防止同一个热启动 Serverless 实例内的重复执行，不能提供跨实例分布式锁，也不能跨实例重启持久化；近期事件历史在此模式下不可用。
- **Redis 状态存储。** 配置 Redis 后，每日任务认领通过原子操作完成；锁的更新和释放会校验随机所有权 Token。任务状态保留两天，任务锁有效期为两小时；近期事件历史保留 14 天，最多保存 80 条。
- **逐条保存推送进度。** Telegram 每成功确认一条消息，系统就保存一次已发送数量，降低多条消息推送到一半后整份重发的风险。
- **结果不明确时不自动重试。** 网络错误或服务端错误可能发生在 Telegram 已经接收消息之后。此类任务会标记为 `delivery_unknown` 并保持阻止状态，以优先避免重复早报。手动重试前应先检查目标 Telegram 聊天记录。Telegram `sendMessage` 不提供通用幂等键。
- **明确拒绝与结果未知分开处理。** Telegram 4xx 响应视为明确拒绝；HTTP 429 在等待时间足够短时会进行有限次数重试。
- **先确认推送，再保存历史。** 所有消息均确认发送成功后，任务先标记为 `sent`，再保存近期事件历史。即使历史写入失败，也不会因此重新发送当天早报。
- **时间戳限制。** 新闻主时间窗口为滚动 24 小时。缺少可靠时间戳的内容（通常是社区热门列表）可能保留，但会受到排序评分惩罚，不会被直接视为已确认的新鲜新闻。
- **GitHub 数据口径。** GitHub 采集关注近期有推送活动的仓库，并按总 Star 数排序；它不代表过去七天新增 Star 数。
- **内容范围。** AI 摘要基于采集到的标题和摘要片段生成，项目不会声称已经读取新闻网页全文。
- **上游依赖。** 外部 API 和 RSS 源可能变化或不可用。单个订阅源失败不会中断其他源；若早报内容不完整，应检查 Vercel Function Logs 和采集器统计。

## 运行监控

每次成功运行后，可在 Vercel Function Logs 中查找结构化日志 `daily_news_completed`，重点关注：

| 字段 | 含义 |
| --- | --- |
| `newsCount` | 预处理后的新闻数量 |
| `eventCount` | 整理后的事件数量 |
| `messageCount` | Telegram 推送消息条数 |
| `aiCurated` | 本次是否成功使用 AI 整理 |
| `redis` | 当前是否启用了 Redis 配置 |
| `collectorStats` | 各采集器的执行结果 |
| `durationMs` | 本次任务总耗时 |

接口响应中的 `ai_curated` 仅表示 AI 整理是否成功，不代表整个早报任务的成功状态。

## 安全机制

- Cron 接口仅接受 GET 请求，并要求 Bearer Token 认证。
- 使用常量时间比较校验 Cron Token。
- Telegram HTML 内容经过转义，外发链接仅允许 HTTP(S)。
- AI 输出经过结构校验，来源 ID 必须对应本次采集记录。
- 不向接口调用方返回上游原始错误或敏感凭据。
- 不要将 `CRON_SECRET`、Telegram 凭据、DeepSeek API Key 或 Redis Token 提交到 Git，也不要在日志中输出这些凭据。
