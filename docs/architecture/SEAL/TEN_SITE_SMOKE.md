# 10-site smoke protocol — SEAL-00

**Purpose:** Repeatable proof that universal ingest → panel → queue → export → ACK works per customer site before scaling cuts.

**Prerequisites:** Site has tracker installed, origin verified, marketing consent configured, Google Ads conversion actions named `OpsMantik_*`.

## Per-site checklist

| # | Step | Pass criteria | Evidence to capture |
|---|------|---------------|---------------------|
| 1 | Tracker heartbeat | `core.js` loads; sync events in last 24h | event count / last `created_at` |
| 2 | Test intent | Phone or WA click creates call row | `calls.id`, `intent_action` |
| 3 | Panel visibility | Intent appears on `/panel` Today Desk | screenshot / RPC row |
| 4 | Click-id or hash | Boolean: gclid/wbraid/gbraid **or** `caller_phone_hash_sha256` | no raw phone in export preview |
| 5 | Stage: Contacted | `POST /api/intents/{id}/stage` 200 | outbox row or queue row |
| 6 | Export batch | Script pulls `/api/oci/google-ads-export` | batch id, row count |
| 7 | Script ACK | `POST /api/oci/ack` | queue status UPLOADED/COMPLETED per contract |
| 8 | UI label | Operator sees “pending confirmation” not “Google confirmed” unless proof | screenshot |
| 9 | Won path (optional) | Seal with amount → `OpsMantik_Won` | queue `optimization_stage=won` |
| 10 | Junk path (optional) | Junk → `OpsMantik_Junk_Exclusion` | terminal exclusion |

## Sign-off row (spreadsheet template)

| Site name | site_id | Date | Operator | Steps 1–8 | Failed step | Notes |
|-----------|---------|------|----------|-------------|-------------|-------|
| | | | | PASS/FAIL | | |

## Deploy gate (after code changes)

```bash
npm run test:release-gates
```

Attach CI output or `release:evidence:pr` snippet to PR.

## Rollback

- Revert deploy commit
- OCI rows: use ack-failed + maintenance break-glass; **no** ad-hoc SQL status updates
- vercel cron: restore row from [CRON_CONTRACT.md](./CRON_CONTRACT.md)

## Koç reference site (prod probe)

- Site id: `3276893e-0433-4e35-95f2-4e80cf863f4c` (Koç Oto Kurtarma)
- Use for first full pass before rolling to 9 other sites
