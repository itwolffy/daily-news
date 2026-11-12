# Daily News Bot

[English](README.md) | [简体中文](README.zh-CN.md)

A personal daily news digest powered by Vercel Cron, DeepSeek and Telegram. It collects technology, AI, business, finance and developer-community updates, filters and groups related reports, then sends a Simplified Chinese digest to a Telegram chat.

## How it works

```text
Vercel Cron
    |
    v
/api/cron ---- authentication
    |
    v
Parallel collectors
(Hacker News / GitHub / 36Kr / WallStreetCN / Zhihu / V2EX / RSS)
    |
    v
Normalize -> validate -> 24-hour window -> deduplicate -> rank
    |
    v
DeepSeek curation (or deterministic fallback)
    |
    v
Validate source IDs and restore trusted source URLs
    |
    v
Build Telegram HTML -> split into messages -> send
    |
    v
Persist delivery progress and recent-event history (optional Redis)
```

### What it does

- **Multi-source collection** — fetches Hacker News, recently active GitHub repositories, 36Kr, WallStreetCN, Zhihu, V2EX and RSS/Atom feeds in parallel.
- **News normalization and ranking** — validates HTTP(S) links, filters against a rolling 24-hour publication window, deduplicates URL/title pairs, and scores recency, source quality, engagement and content completeness.
- **AI curation** — DeepSeek groups reports about the same event, ranks importance, and produces a Simplified Chinese summary, impact analysis and follow-up point.
- **Source traceability** — model-returned source IDs must match records collected in the current run. Final source names and URLs come from collector data, not model-generated links.
- **Fallback mode** — if the API key is absent, the request fails or the model output fails validation, the bot uses a local rule-based fallback. It keeps Chinese-language items and skips AI cross-source clustering and analysis.
- **Telegram delivery** — escapes HTML and splits output at complete HTML block boundaries to stay below Telegram's 4096-character message limit.
- **Optional run state** — Upstash Redis REST can persist daily run locks, delivery checkpoints and recent-event history.

## Deploy to Vercel

### Requirements

- Node.js 20+
- A Vercel project connected to this repository
- A Telegram bot and destination chat
- A DeepSeek API key for AI curation (optional; fallback mode works without it)

### Steps

1. Import this repository into Vercel and deploy it.
2. Add the environment variables listed below to the Vercel project.
3. Set the variables for the **Production** environment and redeploy so they take effect.
4. Confirm the Cron entry exists under Vercel project settings.
5. Check **Functions → Logs** for the `daily_news_completed` event after a run.

The Cron schedule is `0 1 * * *`: every day at **01:00 UTC (09:00 Asia/Shanghai)**.

### Environment variables

#### Required

| Variable | Description |
| --- | --- |
| `CRON_SECRET` | Random secret protecting the Cron endpoint. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`. Manual requests must use the same header. |
| `TG_BOT_TOKEN` | Telegram Bot token. |
| `TG_CHAT_ID` | Telegram destination chat ID. |

#### Optional

| Variable | Default / description |
| --- | --- |
| `DEEPSEEK_API_KEY` | Enables AI curation. Without it, the local fallback is used. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com`. |
| `DEEPSEEK_MODEL` | `deepseek-chat`. |
| `DEEPSEEK_TIMEOUT_MS` | DeepSeek request timeout in milliseconds; defaults to `30000`. |
| `WEATHER_CITY` | City shown in the digest header; defaults to Hong Kong. |
| `WEATHER_LAT`, `WEATHER_LON` | Coordinates for the header weather. |
| `NEWS_RSS_URLS` | Comma-separated RSS/Atom URLs. When set, this list replaces the default feed list. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional Upstash Redis REST credentials. The compatible `KV_REST_API_URL` and `KV_REST_API_TOKEN` pair is also supported. Configure both URL and token. |
| `HTTP_TIMEOUT_MS` | Collector HTTP timeout in milliseconds; defaults to `8000`. |

Do not commit secrets to the repository. Configure them in Vercel Environment Variables.

## Local development

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Start the local Vercel development server:

```bash
npm start
```

The Cron handler accepts **GET** requests only. To invoke it manually, send:

```http
GET /api/cron
Authorization: Bearer <CRON_SECRET>
```

## Reliability and operational behavior

- **Redis is optional.** Without Redis, run state and locks use in-memory Maps. This can prevent duplicate work within one warm serverless instance, but it is not a distributed lock and does not persist across instances or restarts. Recent-event history is unavailable in this mode.
- **Redis-backed state.** With Redis configured, the daily claim is atomic. Lock operations verify a random ownership token. Run state is retained for two days; the lock expires after two hours; recent-event history is retained for 14 days and capped at 80 events.
- **Delivery checkpoints.** After each Telegram message is acknowledged, the sent-message count is persisted. This reduces the risk of resending a partially delivered multi-message digest.
- **Ambiguous delivery is not retried automatically.** A network error or server-side failure may occur after Telegram accepted a message. Such runs are marked `delivery_unknown` and kept blocked to favor avoiding duplicate digests. Check the destination chat before any manual retry. Telegram `sendMessage` does not provide a general idempotency key.
- **Known rejection differs from an unknown outcome.** Telegram 4xx rejections are treated as explicit failures; HTTP 429 responses receive bounded retries when the requested wait is short enough.
- **Sent before history.** Once all messages are acknowledged, the run is marked `sent` before recent-event history is saved. A history-write failure therefore does not trigger another digest for the same day.
- **Timestamp caveat.** The main news window is rolling 24 hours. Items without reliable timestamps (often community hot lists) may be retained with a ranking penalty; they are not treated as confirmed fresh news.
- **GitHub caveat.** The GitHub collector looks at recently pushed repositories and sorts by total stars. It does not measure seven-day star growth.
- **Content scope.** AI summaries are based on collected titles and excerpts. The bot does not claim to have fetched and read the full article body.
- **Upstream dependencies.** External APIs and feeds can change or fail. Individual feed failures are isolated; inspect Vercel Function Logs and collector statistics when a digest looks incomplete.

## Monitoring

After a successful run, look for the `daily_news_completed` structured log. Useful fields include:

- `newsCount` — number of prepared news items
- `eventCount` — number of curated events
- `messageCount` — number of Telegram messages sent
- `aiCurated` — whether AI curation succeeded
- `redis` — whether Redis configuration is active
- `collectorStats` — per-collector results
- `durationMs` — total execution time

The API response field `ai_curated` reports whether AI curation succeeded; it is not the overall job success indicator.

## Security

- The Cron endpoint accepts GET only and requires a Bearer token.
- The token comparison uses a constant-time comparison.
- Telegram HTML is escaped, and outgoing links are restricted to HTTP(S).
- AI output is validated, and source IDs are resolved against current-run collector records.
- Raw upstream errors and credentials are not returned to API callers.
- Never commit or log `CRON_SECRET`, Telegram credentials, DeepSeek API keys or Redis tokens.
