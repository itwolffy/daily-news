# Daily News Bot 2.0

[English](README.md) | [简体中文](README.zh-CN.md)

A Vercel Cron job that collects technology, AI, business, finance and developer news, curates it with DeepSeek, and delivers a Telegram digest.

## Pipeline

1. Parallel collectors: Hacker News, GitHub, 36Kr, WallStreetCN, Zhihu, V2EX and RSS/Atom feeds.
2. Normalize records, validate HTTP(S) URLs, apply a rolling 24-hour publication window, deduplicate URL/title pairs and score source quality, recency, engagement and content completeness.
3. DeepSeek groups reports about the same event, ranks importance, writes a factual summary, explains impact and identifies a verifiable follow-up.
4. Every model-returned source ID is resolved against collected records. URLs and source names are restored from trusted collector data; model-generated URLs are never used.
5. Telegram output is escaped and split at complete HTML block boundaries below 4096 characters.
6. Optional Redis state stores a daily run lock and rolling event history.

## Deploy

- Node.js 20 or newer.
- Deploy the repository to Vercel.
- Configure environment variables below.
- Vercel Cron invokes `/api/cron` daily at 01:00 UTC (09:00 Asia/Shanghai).
- Set `CRON_SECRET` to a long random secret. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Manual requests must send the same header.

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Protects the cron endpoint. Required. |
| `TG_BOT_TOKEN` | Telegram bot token. |
| `TG_CHAT_ID` | Destination chat ID. |

### Optional environment variables

| Variable | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY` | Enables AI clustering and curation; without it deterministic fallback is used. |
| `DEEPSEEK_BASE_URL` | Defaults to `https://api.deepseek.com`. |
| `DEEPSEEK_MODEL` | Defaults to `deepseek-chat`. |
| `WEATHER_CITY`, `WEATHER_LAT`, `WEATHER_LON` | Header weather location; defaults to Hong Kong. |
| `NEWS_RSS_URLS` | Comma-separated RSS/Atom URLs; replaces the default feed list. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional Upstash Redis REST. Vercel KV-compatible `KV_REST_API_URL` and `KV_REST_API_TOKEN` are also recognized. |
| `HTTP_TIMEOUT_MS` | Collector HTTP timeout; defaults to 8000. |

## Local development

Run `npm install`, then `npm test`. Invoke locally with GET and `Authorization: Bearer <CRON_SECRET>`.

## Operational notes

- Never commit or log `CRON_SECRET`, Telegram token, DeepSeek key or Redis token.
- Without Redis, the in-memory lock only prevents duplicate execution within one warm serverless instance. It is not a distributed lock and provides no durable event history. Configure Redis for cross-instance locking and history.
- Redis run locks expire after two hours. Each run owns a random lock token; release and completion are compare-and-set operations, so an expired run cannot delete a newer run's lock.
- Telegram delivery is checkpointed after each acknowledged message. After any send attempt with an ambiguous outcome, the run is retained as `delivery_unknown` and is not automatically retried, because Telegram `sendMessage` has no idempotency key. This favors avoiding duplicate digests over automatic recovery; inspect the Telegram chat and run state before manually retrying.\n- A fully sent digest is marked `sent` before event-history persistence. If history persistence fails, the same date remains blocked rather than sending the digest again.
- The publication window is rolling 24 hours. Items without reliable timestamps (typically community hot lists) are retained with a ranking penalty; they are not assumed to be fresh.
- GitHub query uses recently pushed repositories sorted by total stars. It measures recent activity, not seven-day star growth.
- RSS parser supports common RSS 2.0 and Atom fields; it is not a general-purpose XML parser. Feed failures are isolated.
- The bot does not claim to have read article bodies. AI summaries use collected titles and excerpts only.
- Upstream source APIs and feeds can change. Monitor collector counts in Vercel function logs.

## Security

The endpoint only accepts GET and requires a constant-time bearer-token comparison. Telegram HTML is escaped, links are restricted to HTTP(S), model output is validated and source IDs are resolved against collector records. Raw upstream errors and credentials are not returned to callers.
