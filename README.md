# Daily News Bot

[English](README.md) | [简体中文](README.zh-CN.md)

A personal, automated daily news digest built with Vercel Cron, DeepSeek and Telegram. It collects updates from technology, AI, business, finance and developer communities, turns related reports into structured events, and delivers a Simplified Chinese briefing to a Telegram chat and, optionally, to a WeChat account through PushPlus.

The project is designed for long-term personal use: predictable scheduled execution, source traceability, duplicate-risk reduction and explicit handling of uncertain delivery outcomes.

## Features

- **Registry-based collection** — Hacker News, recently active GitHub repositories, 36Kr, WallStreetCN, Zhihu, V2EX and configurable RSS/Atom feeds are registered through a collector registry. Collectors run in parallel; an individual source failure does not stop the others. Each run records per-collector item counts and success status.
- **Normalization and ranking** — validates HTTP(S) URLs, applies a rolling 24-hour publication window, deduplicates normalized URL/title pairs, and ranks items using source weight, recency, engagement and content completeness.
- **AI event curation** — DeepSeek groups reports about the same underlying event, assigns an importance score, and generates a Chinese factual summary, impact analysis and follow-up point.
- **Evidence-aware summaries** — distinguishes media reports, multi-source reports, unverified claims and analysis. High-risk personal or criminal allegations are marked as unverified.
- **Source traceability** — model-generated source IDs must match items collected in the current run. Displayed source names and URLs are restored from collector records rather than trusted from model output.
- **Deterministic fallback** — if DeepSeek is unavailable or its output fails validation, the bot displays up to 12 eligible Chinese-language items without AI cross-source clustering or analysis.
- **Channel-based delivery** — delivery channels follow a shared contract (`name`, `validateConfig()`, `deliver()`). Telegram is enabled by default. Setting `PUSHPLUS_TOKEN` also enables the PushPlus WeChat Official Account channel without changing collection or curation. Telegram delivery escapes HTML, validates outgoing links and splits messages at complete content-block boundaries below Telegram's 4096 characters.
- **Optional persistent state** — Upstash Redis REST stores daily run state, delivery checkpoints, locks and recent-event history. Redis is optional; no Redis server is required for the basic deployment.
- **Digest context** — the header can include weather, USD/CNY exchange rate and Bitcoin price/change. Header data sources are independent, so one unavailable API does not suppress the rest.

## Architecture

The code is organized by responsibility:

| Path | Responsibility |
| --- | --- |
| `api/cron.js` | HTTP entry point, GET check and Bearer-token authentication |
| `src/jobs/` | Daily job orchestration, run claiming, delivery sequencing and completion |
| `src/collectors/` | Collector implementations and the collector registry |
| `src/services/` | News normalization/ranking, AI curation, header data and state storage |
| `src/channels/` | Shared channel contract and channel-specific formatting/delivery adapters |
| `src/utils/` | Shared date, HTTP and weather utilities |
| `test/` | Automated tests for collectors, delivery contracts, job states and reliability behavior |

To add a news source, implement a collector and register it in `src/collectors/index.js`. To add a delivery destination, implement `validateConfig()` and `deliver(digest, { onSent })`, return `{ messageCount }`, and inject/register the channel in the job configuration. A channel's `onSent` callback should report acknowledged message progress so it can be checkpointed. PushPlus is opt-in and remains disabled when `PUSHPLUS_TOKEN` is absent. A successful PushPlus API response means the platform accepted the request, not that WeChat displayed the message.

## Processing flow

```text
Vercel Cron
    |
    v
/api/cron -- method check + Bearer authentication
    |
    v
Parallel collectors
(Hacker News / GitHub / 36Kr / WallStreetCN / Zhihu / V2EX / RSS)
    |
    v
Normalize -> validate URLs -> rolling 24-hour window -> deduplicate -> rank
    |
    v
DeepSeek event curation (or local fallback)
    |
    v
Validate source IDs -> restore trusted source metadata
    |
    v
Validate configured channels -> deliver sequentially
    |
    v
Persist per-channel acknowledged-message counts and states
    |
    v
Mark all channels sent -> save recent-event history
              (Redis optional)
```

## Deploy to Vercel

### Requirements

- Node.js 20+
- A Vercel project connected to this repository
- A Telegram bot and destination chat; a PushPlus account/token is optional
- A DeepSeek API key for AI curation (optional; fallback mode works without it)

### Setup

1. Import this repository into Vercel and complete the first deployment.
2. Add the environment variables below in **Settings → Environment Variables**.
3. Configure at least the required variables for the **Production** environment.
4. Redeploy after changing environment variables.
5. Confirm the Cron entry is present in the Vercel project settings.
6. After a scheduled or manual run, inspect **Functions → Logs** for `daily_news_completed`.

The Cron expression is `0 1 * * *`: every day at **01:00 UTC (09:00 Asia/Shanghai)**.

### Environment variables

#### Required

| Variable | Description |
| --- | --- |
| `CRON_SECRET` | Random secret protecting the Cron endpoint. Requests must use `Authorization: Bearer <CRON_SECRET>`. |
| `TG_BOT_TOKEN` | Telegram Bot token. |
| `TG_CHAT_ID` | Destination Telegram chat ID. |
| `PUSHPLUS_TOKEN` | Optional. Enables PushPlus WeChat delivery when set; otherwise Telegram remains the only channel. |

#### Optional

| Variable | Default / description |
| --- | --- |
| `DEEPSEEK_API_KEY` | Enables AI curation. Without it, local fallback mode is used. |
| `DEEPSEEK_BASE_URL` | DeepSeek API base URL; defaults to `https://api.deepseek.com`. |
| `DEEPSEEK_MODEL` | Model name; defaults to `deepseek-chat`. |
| `DEEPSEEK_TIMEOUT_MS` | DeepSeek request timeout in milliseconds; defaults to `30000`. |
| `WEATHER_CITY` | City displayed in the digest header; defaults to Hong Kong. |
| `WEATHER_LAT`, `WEATHER_LON` | Coordinates used for header weather; defaults to Hong Kong coordinates. |
| `NEWS_RSS_URLS` | Comma-separated RSS/Atom URLs. When set, this list replaces the default feed list. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional Upstash Redis REST credentials. The compatible `KV_REST_API_URL` and `KV_REST_API_TOKEN` pair is also supported. Configure both values from one pair. |
| `HTTP_TIMEOUT_MS` | Collector HTTP timeout in milliseconds; defaults to `8000`. |

Never commit secrets to the repository. Keep `PUSHPLUS_TOKEN` private alongside the other credentials. Store production credentials in Vercel Environment Variables.

## Local development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Start the local Vercel development server:

```bash
npm start
```

The Cron handler accepts **GET** requests only. To invoke it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

The endpoint returns a JSON result. The `ai_curated` field indicates whether AI curation succeeded; it does **not** represent the overall job status by itself.

## Reliability and delivery semantics

### Redis is optional

Without Redis, run state and locks use process-local in-memory Maps. This can prevent duplicate execution inside the same warm serverless instance, but it is **not a distributed lock** and does not survive instance replacement or restart. Recent-event history is unavailable in this mode.

With Redis configured:

- Daily run claiming and lock ownership checks use atomic Redis scripts.
- A lock expires after 2 hours; run state is retained for 2 days.
- Recent-event history is retained for 14 days and capped at 80 events.
- Lock updates and release operations verify a random ownership token.

### Telegram and PushPlus delivery

- Telegram messages are sent sequentially; PushPlus reuses the digest HTML formatter and submits its content chunks separately.
- After Telegram acknowledges each message, the acknowledged-message count is persisted.
- A known Telegram 4xx rejection is treated as an explicit rejection. HTTP 429 responses receive bounded retries when the requested wait is no more than 10 seconds.
- PushPlus uses asynchronous acceptance: a successful API response means PushPlus accepted the request, not that the WeChat client received or displayed it. Network/server errors may occur after upstream acceptance, so the outcome can be ambiguous.
- Network errors and server-side errors have an ambiguous outcome: Telegram may have accepted a message before the connection failed. Such runs are marked `delivery_unknown` and are not automatically retried. Check the destination chat before any manual retry; Telegram `sendMessage` does not provide a general idempotency key.
- After every channel has acknowledged delivery, the run is marked `sent` with a `historyStatus: pending` checkpoint and the events needed for history persistence. A history-write failure therefore does not cause the digest to be sent again. The daily run record retains the pending history payload for manual diagnosis/recovery; the application does not automatically retry this history write.

These mechanisms reduce duplicate-delivery risk; they do not guarantee exactly-once delivery across all infrastructure failures.

### Channel state and partial delivery

- The job validates the configuration of every configured channel before starting the first delivery, so a missing destination configuration is detected before any channel is sent a digest.
- Channels are delivered sequentially. Their run-level states include `pending`, `sending`, `sent`, `rejected` and `delivery_unknown`; acknowledged message counts are checkpointed through the state store. A channel that acknowledges one or more messages and then fails is recorded as `delivery_unknown`, not `rejected`.
- If a channel explicitly rejects delivery before any message has been acknowledged by any channel, the job first persists the `rejected` state and only then releases the lock. If that state write fails, the lock is retained.
- If an earlier channel has already acknowledged messages and a later channel fails, or if delivery outcome is ambiguous, the run is retained as `delivery_unknown` rather than automatically replaying the entire digest. Check each destination before manually retrying.
- Completion updates preserve the acknowledged-message counts and per-channel states. A history write failure leaves the run in `sent` with `historyStatus: pending` and the event payload recorded; it does not make delivery eligible for retry.
- Channel state is part of the daily run record; this is not a separate permanent per-channel audit-history system.

## Data and content limitations

- The primary news window is rolling 24 hours. Items without reliable timestamps may be retained with a ranking penalty; they are not treated as confirmed fresh news.
- The GitHub collector considers recently pushed repositories and sorts by total stars. It does not measure seven-day star growth.
- AI summaries are based on collected titles and excerpts. The bot does not claim to have fetched or read the full article body.
- In fallback mode, only eligible Chinese-language items are shown, up to 12. Cross-source event clustering, AI analysis and AI ranking are unavailable.
- External APIs and feeds can change or fail. Collector failures are isolated; inspect logs and collector statistics if a digest appears incomplete.

## Monitoring

After a successful run, find the structured log event `daily_news_completed` in Vercel Function Logs.

| Field | Meaning |
| --- | --- |
| `newsCount` | Number of prepared news items |
| `eventCount` | Number of curated events |
| `messageCount` | Number of Telegram messages sent |
| `aiCurated` | Whether AI curation succeeded |
| `redis` | Whether Redis configuration is active |
| `collectorStats` | Per-collector item counts and success status |
| `durationMs` | Total job duration |

## Security

- The Cron endpoint accepts GET requests only and requires Bearer-token authentication.
- The token comparison uses a constant-time comparison.
- Telegram HTML is escaped, and outgoing links are restricted to HTTP(S).
- AI output is validated; source IDs must resolve to current-run collector records.
- Raw upstream errors and credentials are not returned to API callers.
- Never commit or log `CRON_SECRET`, Telegram credentials, DeepSeek API keys or Redis tokens.
