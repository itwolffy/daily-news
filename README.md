# Daily News Bot

[English](README.md) | [简体中文](README.zh-CN.md)

A personal, automated daily news digest built with Vercel Cron, DeepSeek and Telegram. It collects updates from technology, AI, business, finance and developer communities, turns related reports into structured events, and delivers a Simplified Chinese briefing to a Telegram chat.

The project is designed for long-term personal use: predictable scheduled execution, source traceability, duplicate-risk reduction and explicit handling of uncertain delivery outcomes.

## Features

- **Multi-source collection** — Hacker News, recently active GitHub repositories, 36Kr, WallStreetCN, Zhihu, V2EX and configurable RSS/Atom feeds. Collectors run in parallel; an individual source failure does not stop the others.
- **Normalization and ranking** — validates HTTP(S) URLs, applies a rolling 24-hour publication window, deduplicates normalized URL/title pairs, and ranks items using source weight, recency, engagement and content completeness.
- **AI event curation** — DeepSeek groups reports about the same underlying event, assigns an importance score, and generates a Chinese factual summary, impact analysis and follow-up point.
- **Evidence-aware summaries** — distinguishes media reports, multi-source reports, unverified claims and analysis. High-risk personal or criminal allegations are marked as unverified.
- **Source traceability** — model-generated source IDs must match items collected in the current run. Displayed source names and URLs are restored from collector records rather than trusted from model output.
- **Deterministic fallback** — if DeepSeek is unavailable or its output fails validation, the bot displays up to 12 eligible Chinese-language items without AI cross-source clustering or analysis.
- **Telegram delivery** — escapes HTML, validates outgoing links and splits messages at complete content-block boundaries below Telegram's 4096-character limit.
- **Optional persistent state** — Upstash Redis REST stores daily run state, delivery checkpoints, locks and recent-event history. Redis is optional; no Redis server is required for the basic deployment.
- **Digest context** — the header can include weather, USD/CNY exchange rate and Bitcoin price/change. Header data sources are independent, so one unavailable API does not suppress the rest.

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
Build Telegram HTML -> split messages -> send sequentially
    |
    v
Persist acknowledged-message count -> mark sent -> save recent-event history
              (Redis optional)
```

## Deploy to Vercel

### Requirements

- Node.js 20+
- A Vercel project connected to this repository
- A Telegram bot and destination chat
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

Never commit secrets to the repository. Store production credentials in Vercel Environment Variables.

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

### Telegram delivery

- Messages are sent sequentially.
- After Telegram acknowledges each message, the acknowledged-message count is persisted.
- A known Telegram 4xx rejection is treated as an explicit rejection. HTTP 429 responses receive bounded retries when the requested wait is no more than 10 seconds.
- Network errors and server-side errors have an ambiguous outcome: Telegram may have accepted a message before the connection failed. Such runs are marked `delivery_unknown` and are not automatically retried. Check the destination chat before any manual retry; Telegram `sendMessage` does not provide a general idempotency key.
- After every message is acknowledged, the run is marked `sent` before recent-event history is saved. A history-write failure therefore does not cause the digest to be sent again that day.

These mechanisms reduce duplicate-delivery risk; they do not guarantee exactly-once delivery across all infrastructure failures.

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
