# Production OCI change — evidence pack (one page)

Paste this checklist into the change ticket. Commands assume repo root and approved credentials.

## 1. Release gates (CI + commit)

- [ ] `npm run test:release-gates` green locally **or** PR CI run URL attached with **commit SHA**.
- [ ] Optional strict bundle (approved read-only env only): `TARGET_DB_EVIDENCE_STRICT=1 npm run release:evidence:production` — see [`docs/runbooks/OCI_HARDENING_OPERATIONS.md`](../runbooks/OCI_HARDENING_OPERATIONS.md).

## 2. Migrations (drift / applied order)

- [ ] Supabase MCP `list_migrations` screenshot or paste **or** `node scripts/supabase-with-env.mjs migration list --linked` (whichever is org standard).
- [ ] Evidence script critical list includes sprint guards: run `npm run release:evidence:pr` and confirm `scripts/release/collect-gate-evidence.mjs` `CRITICAL_MIGRATIONS` entries for `20261229120000_*` and `20261229120500_*` are present in output when applicable.

## 3. PR-9K / script-unconfirmed semantics

- [ ] `OUTPUT_JSON=1` dry-run archive: [`scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs`](../../scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs) when touching script-unconfirmed remediation or ACK shapes.

## 4. Post-deploy queue health (read-only)

- [ ] `offline_conversion_queue.status` distribution for affected `site_id` (read-only SQL or existing health script output) attached to ticket.

## 5. Google Ads Script

- [ ] Ads Editor / project **version or timestamp** screenshot **or** build reference per [`scripts/google-ads-oci/README.md`](../../scripts/google-ads-oci/README.md).

## 6. Canary / PR-G cross-check

- [ ] [`docs/OPS/PRODUCTION_CANARY_DOSSIER.md`](./PRODUCTION_CANARY_DOSSIER.md) — **OCI Truth sprint closure checklist (PR-G)** section ticked for this change.

## 7. Ledger hygiene

- [ ] No ad-hoc `UPDATE offline_conversion_queue` in ops notes; repair paths per [`docs/runbooks/OCI_QUEUE_REPAIR_INDEX.md`](../runbooks/OCI_QUEUE_REPAIR_INDEX.md) and RPC/cron SSOT only.

## Artefact list (minimum)

| Artefact | Where |
|----------|--------|
| CI release-gates log + SHA | GitHub Actions / attachment |
| Migration list | MCP or CLI |
| PR-9K JSON dry-run | Ticket attachment |
| Queue status snapshot | Ticket attachment |
| Script version evidence | Screenshot or README ref |
| Billing hook (if export-related) | [`docs/architecture/BILLING_CONVERSION_SENDS_SSOT.md`](../architecture/BILLING_CONVERSION_SENDS_SSOT.md) |
