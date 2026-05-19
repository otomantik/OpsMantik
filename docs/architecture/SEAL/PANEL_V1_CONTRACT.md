# Panel V1 execution contract — SEAL-00

**Canonical route:** `/panel` ([`app/panel/page.tsx`](../../../app/panel/page.tsx))  
**Current data:** SSR `get_recent_intents_lite_v1` + Supabase realtime on `calls`  
**Current mutations (client):** [`panel-feed.tsx`](../../../components/dashboard/panel-feed.tsx) → `stage`, `status`, `seal`

## Three blocks only

### 1. Today Desk

**Shows**

- Unreviewed high-intent calls (phone / WhatsApp / form)
- Source evidence (`utm_term`, device from session join — not `calls.keyword`)
- Click-id present (boolean)
- Hashable phone present (boolean — **not** raw number on card)
- Current stage + next operator action

**Actions**

- Contacted / Offered / Won / Junk (existing APIs)
- Note — only if API already wired
- Attribution trace — session fields only (no truth explain in v1)

### 2. OCI Status Strip

**Shows**

- Counts: QUEUED, PROCESSING, UPLOADED, COMPLETED, FAILED, DEAD_LETTER
- Last export time, last ACK, script heartbeat age
- Labels: **pending confirmation** vs **closed** per lifecycle contract
- **Never** “Google confirmed” without provider proof

**API (v1 target)**

- Lightweight poll: `/api/oci/queue-stats` (30–60s max)
- Today: full OCI control lives in admin [`oci-control-panel.tsx`](../../../components/dashboard/oci-control/oci-control-panel.tsx) — **do not** import into panel v1 wholesale

### 3. Install / Site Health Strip

**Shows**

- Tracker installed, last event, origin verified, script version, consent summary
- Detector flags: phone / WhatsApp / form (from recent events)

**APIs**

- `/api/sites/[siteId]/tracker-embed`
- `/api/sites/[siteId]/origins/verify`

## Forbidden imports (panel bundle boundary)

Must **not** appear in `app/panel/**` or panel-only components:

- `useFunnelAnalytics`, `CROInsights`
- `recharts` / chart libraries
- `/api/dashboard/spend`, `/api/webhooks/google-spend`
- `/api/stats/*`, `/api/reporting/dashboard-stats`
- Conversations UI / `/api/conversations/*`
- `/api/truth/explain/*`
- Full session live feed table
- Google spend types / `google_ads_spend` module UI

**SEAL-00 verified:** `/app/panel` has no funnel/spend imports.

**Planned test:** `tests/unit/panel-bundle-boundary.test.ts` (SEAL-04)

## Landing

Operators should land on `/panel` ([`resolveLandingRoute`](../../../lib/auth/landing-route.ts) — PR-OM-SEAL-03).

## ACK copy rule

Use: “Uploaded to script” / “Pending confirmation” / “Closed (unverified)” — not “Imported by Google” unless proof exists.
