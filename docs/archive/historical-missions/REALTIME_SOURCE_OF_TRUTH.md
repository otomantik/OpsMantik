# Realtime Source of Truth

**Purpose:** Clarify when Redis vs DB is authoritative for dashboard counts. Prevents operator confusion.

---

## Semantics

| Source | Scope | Used For | Latency |
|--------|-------|----------|---------|
| **DB (PostgreSQL)** | Historical + sealed/queue | `get_command_center_p0_stats_v2`, `get_recent_intents_v2`, queue counts, OCI stats | ~100–500 ms |
| **Redis (Upstash)** | Today only (TRT) | `captured`, `gclid`, `junk` — overlay for in-flight intents | ~50–200 ms |

---

## Merge Rules (Command Center P0)

1. **DB is base** — `sealed`, `junk`, `total_leads`, `gclid_leads` come from RPC.
2. **Redis overlay** — Poll `/api/stats/realtime` every 10s; use `Math.max(DB_value, Redis_value)` for today.
3. **Why overlay?** QStash worker processes events async; Redis is incremented immediately. DB catches up within seconds.

---

## Polling Layers

| Layer | Interval | Purpose |
|-------|----------|---------|
| Supabase Realtime | WebSocket | Push: calls, sessions, events |
| use-command-center-p0-stats | 10s | Redis overlay for P0 KPI cards |
| use-realtime-dashboard | 500ms (connection), 5min (fallback) | Activity detection, refetch triggers |

---

## Key Files

- `lib/services/stats-service.ts` — Redis `stats:{siteId}:{date}` (HGETALL)
- `app/api/stats/realtime/route.ts` — GET handler
- `lib/hooks/use-command-center-p0-stats.ts` — 10s poll, merge logic
- `lib/hooks/use-realtime-dashboard.ts` — Realtime subscriptions

---

## Known Issues

- `/api/stats/realtime` can hit ~9s on cold start (Upstash serverless). Subsequent requests typically <500ms.
- Redis keys expire after 7 days; older dates return `{ captured: 0, gclid: 0, junk: 0 }`.

---

**Last updated:** 2026-02-02
