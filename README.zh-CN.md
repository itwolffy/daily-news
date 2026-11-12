# Daily News Bot

[English](README.md) | **简体中文**

一个基于 Vercel Cron 的自动化新闻早报项目。项目定时采集科技、人工智能、商业、金融和开发者社区新闻，使用 DeepSeek 进行事件聚合与中文摘要整理，并通过 Telegram 推送。

## 功能特性

- **多源采集**：并行采集 Hacker News、GitHub、36 氪、华尔街见闻、知乎、V2EX 及 RSS/Atom 订阅源。
- **新闻预处理**：统一数据结构，校验 HTTP(S) 链接，保留滚动 24 小时内的新闻，对 URL/标题去重，并根据来源质量、发布时间、热度和内容完整度评分。
- **AI 事件聚合**：调用 DeepSeek，将同一事件的多篇报道合并，评估重要性，生成事实摘要、影响分析和后续观察点。
- **中文输出校验**：AI 生成的标题和摘要必须包含中文；英文新闻会被要求翻译为简体中文。不符合校验的事件会被丢弃。
- **来源可追溯**：模型返回的来源 ID 必须能在本次采集结果中找到。最终 URL 和来源名称使用采集器中的可信数据，不使用模型生成的 URL。
- **Telegram 推送**：对 HTML 内容进行转义，并按完整 HTML 块拆分消息，避免超过 Telegram 单条消息的 4096 字符限制。
- **可选 Redis**：使用 Redis 保存每日任务锁和近期事件历史，辅助跨实例防重及事件更新识别。

## 新闻处理流程

1. Vercel Cron 定时调用 `/api/cron`。
2. 服务并行执行各新闻采集器，并获取早报头部信息及近期事件历史。
3. 对采集结果进行标准化、时间窗口过滤、去重和评分。
4. 调用 DeepSeek 进行新闻筛选、同事件聚合、重要性排序和简体中文内容生成。
5. 校验模型输出，并将来源 ID 映射回原始采集记录。
6. 构建 Telegram 消息并发送，随后保存近期事件历史和任务完成状态。

### AI 失败时的降级行为

如果没有配置 `DEEPSEEK_API_KEY`、DeepSeek 请求失败，或模型输出未通过校验，系统会使用本地 Fallback：

- 仅保留标题和摘要均包含中文的新闻；
- 最多展示 12 条；
- 不进行 AI 跨来源事件聚合和深度分析；
- 如果没有符合条件的中文新闻，会发送中文提示。

接口返回的 `ai_curated` 字段表示本次是否成功使用 AI 整理：`true` 表示成功，`false` 表示使用了 Fallback。它与整个任务是否成功是两个不同状态。

## 部署

### 环境要求

- Node.js 20 或更高版本
- Vercel 项目
- Telegram Bot

### 部署步骤

1. 将仓库导入 Vercel 并完成部署。
2. 在 Vercel 项目的 Environment Variables 中配置下方环境变量。
3. 确认 Production 环境变量已配置，然后重新部署，使变量生效。
4. Vercel Cron 会按配置定时调用 `/api/cron`。
5. 在 Vercel Function Logs 中检查 `daily_news_completed` 日志，并关注 `aiCurated`、`newsCount`、`eventCount`、`messageCount` 和 `durationMs`。

项目 Cron 配置为每天 **01:00 UTC（北京时间 09:00）** 执行。

### 环境变量

#### 必需变量

| 变量 | 说明 |
| --- | --- |
| `CRON_SECRET` | Cron 接口访问密钥，必须设置为足够长的随机字符串。Vercel Cron 使用 `Authorization: Bearer <CRON_SECRET>` 请求接口；手动调用也必须携带相同请求头。 |
| `TG_BOT_TOKEN` | Telegram Bot Token。 |
| `TG_CHAT_ID` | 接收早报的 Telegram Chat ID。 |

#### 可选变量

| 变量 | 默认值 / 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key。配置后启用 AI 事件聚合和整理；未配置时使用本地 Fallback。 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址，默认 `https://api.deepseek.com`。 |
| `DEEPSEEK_MODEL` | DeepSeek 模型名称，默认 `deepseek-chat`。 |
| `DEEPSEEK_TIMEOUT_MS` | DeepSeek 请求超时时间，单位为毫秒，默认 `30000`（30 秒）。例如 35 秒应填写 `35000`，不要填写 `35`。 |
| `WEATHER_CITY`、`WEATHER_LAT`、`WEATHER_LON` | 早报头部天气位置；默认使用香港。 |
| `NEWS_RSS_URLS` | 逗号分隔的 RSS/Atom URL，用于替换默认订阅源列表。 |
| `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | 可选的 Upstash Redis REST 配置。也支持 Vercel KV 兼容变量 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`。 |
| `HTTP_TIMEOUT_MS` | 新闻采集器 HTTP 请求超时时间，单位为毫秒，默认 `8000`。 |

## 本地开发与测试

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

本地启动 Vercel 开发环境：

```bash
npm start
```

本地手动调用时，使用 GET 请求访问 `/api/cron`，并携带请求头：

```http
Authorization: Bearer <CRON_SECRET>
```

## 运行与运维说明

- 不要将 `CRON_SECRET`、Telegram Bot Token、DeepSeek API Key 或 Redis Token 提交到 Git，也不要在日志中输出这些凭据。
- 未配置 Redis 时，内存锁只能防止同一个热启动 Serverless 实例内的重复执行，不能提供跨实例分布式锁或持久化事件历史。需要跨实例防重和历史记录时，应配置 Redis。
- Redis 任务锁有效期为两小时。捕获到异常时，处理器会尝试释放锁；如果进程崩溃，锁会在过期后自动失效。
- 新闻时间窗口为滚动 24 小时。缺少可靠时间戳的内容（通常是社区热门列表）会保留，但会受到排序评分惩罚，不会被直接视为最新新闻。
- GitHub 采集使用近期有推送活动的仓库，并按总 Star 数排序；它衡量的是近期活跃度，不是过去七天新增 Star 数。
- RSS 解析器支持常见 RSS 2.0 和 Atom 字段，不是通用 XML 解析器。单个订阅源失败不会导致其他订阅源停止采集。
- 项目不会声称已经读取新闻网页全文。AI 摘要仅基于采集到的标题和摘要片段生成。
- 上游 API 和 RSS 源可能发生变化。建议定期检查 Vercel Function Logs 中各采集器的数量和状态。

## 安全机制

- Cron 接口仅接受 GET 请求，并要求 Bearer Token 认证。
- 使用常量时间比较校验 Cron Token。
- Telegram HTML 内容经过转义，链接仅允许 HTTP(S)。
- AI 输出经过结构校验，来源 ID 必须对应本次采集记录。
- 不向接口调用方返回上游原始错误或敏感凭据。
