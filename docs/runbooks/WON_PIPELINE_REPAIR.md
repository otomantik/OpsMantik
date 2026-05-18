# Won pipeline repair (`wonMissingPipeline`)

When `npm run smoke:oci-rollout-readiness:strict` fails with **`wonMissingPipeline>0`**, at least one won/sealed call has **no protective queue row** (`won_missing_unrepresented_count`). This is a **data / enqueue** issue, not a gate threshold to relax.

## Preconditions

- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Site-scoped change ticket and operator id for any write path
- Do **not** delete queue rows or bypass `enqueueSealConversion`

## 1. Diagnose (read-only)

```bash
npm run oci:diagnose-won-missing -- --site=<uuid|public_id|name-fragment>
npm run oci:repair-orphan-won -- --site=<site-uuid>
```

`oci:repair-orphan-won` runs SQL discovery (`scripts/sql/orphan_won_backfill.sql`) without writes.

## 2. Repair (site-scoped)

**Preferred app path** (uses `enqueueSealConversion`):

```bash
npm run oci:repair-enqueue-won-calls -- --site=<filtre>
npm run oci:repair-enqueue-won-calls -- --site=<filtre> --apply
```

Dry-run lists missing call ids; `--apply` enqueues. Calls without click id may become `BLOCKED_PRECEDING_SIGNALS` — that **clears** `wonMissingPipeline` but still blocks Google export until click attribution exists.

**Gated sweep path** (cron-equivalent, production change control):

```bash
export TARGET_SITE_ID=<site-uuid>
export CHANGE_TICKET=OPS-1234
export OPERATOR_ID=you@company
export CONFIRM_ORPHAN_WON_REPAIR=I_UNDERSTAND
export APP_BASE_URL=https://console.opsmantik.com
export CRON_SECRET=<cron-secret>
npm run oci:repair-orphan-won -- --write --site=<site-uuid>
```

## 3. Verify

```bash
npm run oci:diagnose-won-missing -- --site=<filtre>
npm run smoke:oci-rollout-readiness:strict
```

Target: `won_missing_unrepresented_count = 0` for all in-scope sites.

## References

- [OCI_SRE_QUEUE_FOLLOWUP.md](./OCI_SRE_QUEUE_FOLLOWUP.md) — jitter / DLQ context
- [OCI_HARDENING_OPERATIONS.md](./OCI_HARDENING_OPERATIONS.md) — PR-7C protocol
- [EXPORT_CLOSURE.md](../architecture/EXPORT_CLOSURE.md) — STOP gate table
