# OpsMantik V1: Enterprise System Upgrade - Prompt Roadmap

This document outlines a strategic, high-level prompt engineering roadmap to elevate OpsMantik V1 from a "Battle-Ready" state to an **Enterprise-Grade** system. The roadmap focuses on **System Sensing (Observability)**, **Artificial Intelligence (Data Activation)**, and **Autonomy (Self-Healing)**.

Each prompt is designed to be executed sequentially by an advanced AI agent, ensuring architectural integrity and minimal technical debt.

---

##  PHASE 1: SENSING & OBSERVABILITY (The "Silent Scream" Fix)

**Objective:** Transform the system from passive logging to proactive, multi-channel alerting. Ensure critical failures are immediately communicated to stakeholders.

### Prompt 1.1: Telegram Watchtower Integration (Critical)
> **Context:** The current `WatchtowerService` detects failures but only logs them to the console. This is a "Silent Scream" failure mode. We need immediate, actionable notifications.
>
> **Task:**
> 1.  **Create Service:** Implement `lib/services/telegram-service.ts`.
>     *   It must accept a `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from environment variables.
>     *   It should expose a `sendMessage(message: string, level: 'info' | 'warning' | 'alarm')` method.
>     *   'Alarm' messages should be prefixed with "🚨 [CRITICAL]" and mention specific error codes.
> 2.  **Integrate Watchtower:** Modify `lib/services/watchtower.ts`:
>     *   Inject `TelegramService` into the `notify()` method.
>     *   Trigger an alert if:
>         *   `sessionsLastHour === 0` (Total traffic loss).
>         *   `gclidLast3Hours === 0` (Ads tracking failure).
>         *   `errorRate > 5%` (New metric to track).
> 3.  **Test Endpoint:** Create a secure API route `/api/test-notification` (protected by `CRON_SECRET`) to manually trigger a test alert.

### Prompt 1.2: Advanced Heartbeat Optimization (Cost Control)
> **Context:** The tracker (`ux-core.js`) sends a heartbeat every 60 seconds regardless of user activity. This linearly increases database write costs and server load.
>
> **Task:**
> 1.  **Updates to `public/ux-core.js`:**
>     *   Implement an **Adaptive Heartbeat** mechanism.
>     *   **Active State:** If user interacts (scroll, click, type) within the last minute → Keep 60s interval.
>     *   **Idle State:** If no interaction for >1 minute → Increasing backoff (2m, 5m, 10m).
>     *   **Hidden State:** If `document.visibilityState === 'hidden'` → Pause heartbeat, send only on `visibilitychange` (visible) or `beforeunload`.
> 2.  **Batching:** Instead of sending every heartbeat immediately, accumulate minor updates (e.g., scroll percentage) and send them in a single batch with the simplified heartbeat payload.

---

## PHASE 2: INTELLIGENCE & DATA ACTIVATION (Closing the Loop)

**Objective:** Move beyond data *visualization* to *activation*. Feed high-quality signals back to ad platforms to optimize ROAS (Return on Ad Spend).

### Prompt 2.1: Materialized Views for High-Performance Dashboard
> **Context:** The Dashboard currently queries live, row-level data (`events`, `sessions`). As data volume grows (millions of rows), query performance will degrade significantly.
>
> **Task:**
> 1.  **Database Engineering:**
>     *   Create a PostgreSQL Materialized View: `mv_daily_analytics_summary`.
>     *   Aggregation Dimensions: `site_id`, `date`, `traffic_source`, `device_type`.
>     *   Metrics: `total_sessions`, `total_conversions`, `avg_duration`, `bounce_rate`.
>     *   Create a trigger orcron job (pg_cron) to refresh this view every hour.
> 2.  **Backend Integration:**
>     *   Update `StatsService` to prefer querying `mv_daily_analytics_summary` for date ranges > 24 hours.
>     *   Keep live querying only for "Today" view.

### Prompt 2.2: Google Ads CAPI (Conversion API) & Offline Import
> **Context:** We track valuable leads (qualified calls, high intent), but Google Ads is blind to this data. We need to close the feedback loop.
>
> **Task:**
> 1.  **Google Ads Service:**
>     *   Implement `lib/services/google-ads-service.ts`.
>     *   Use Google Ads API (or Google Analytics Measurement Protocol as a proxy).
>     *   Function: `uploadOfflineConversion(gclid: string, conversionName: string, conversionValue: number, conversionTime: string)`.
> 2.  **Automation Logic:**
>     *   Create a new QStash worker: `workers/sync-google-ads`.
>     *   Trigger: When `lead_score > 80` AND `gclid` exists.
>     *   Action: Send the conversion event back to Google Ads with the calculated `lead_score` as the value.

---

## PHASE 3: AUTONOMY & SELF-HEALING (Resilience)

**Objective:** Build a system that can detect its own failures and attempt to fix them without human intervention.

### Prompt 3.1: "Circuit Breaker" & Failover Tracking
> **Context:** If the main API endpoint (`/api/sync`) goes down (e.g., Vercel outage) or gets blocked by client-side filters, we lose 100% of data.
>
> **Task:**
> 1.  **Client-Side Resilience (`ux-core.js`):**
>     *   Define a secondary endpoint: `CONFIG.failoverApiUrl` (e.g., a direct Supabase Edge Function or a separate proxy).
>     *   Implement a **Circuit Breaker**: If main API fails 3 times consecutively (5xx errors or timeout), automatically switch traffic to `failoverApiUrl`.
>     *   Store the "Failover Mode" state in `localStorage` so it persists across page reloads for that user.
> 2.  **Recovery:**
>     *   Periodically (every 10 minutes) probe the main API. If it recovers, switch back to the primary channel.

### Prompt 3.2: Automated Data Integrity Audits
> **Context:** We rely on `Watchtower` for liveness checks, but data *quality* (integrity) requires deeper analysis.
>
> **Task:**
> 1.  **Data Audit Job:**
>     *   Create a scheduled Supabase Edge Function: `audit-data-integrity`.
>     *   **Checks:**
>         *   **Orphaned Events:** Events with no corresponding Session.
>         *   **Time Travel Paradox:** Events with timestamps *before* their Session start time.
>         *   **Attribution Gaps:** Sessions with `utm_source=google` but missing `gclid`.
> 2.  **Reporting:**
>     *   If anomalies exceed a threshold (e.g., 1% of daily data), trigger a **High Priority** Telegram Alert via `TelegramService`.

---

**Analyst Note:** Executing this roadmap will transition OpsMantik into a fully autonomous, self-optimizing "Data Operating System". Start with **Phase 1** to secure the foundation before building the advanced intelligence layers.
