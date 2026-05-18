# Marketing signals audit lane (non-upload)

Per [EXPORT_CLOSURE.md](../architecture/EXPORT_CLOSURE.md), **`marketing_signals` is audit-only**. The Google Ads script batch reads **`offline_conversion_queue`** only (`fetch_oci_google_ads_export_jit_v1`). Do not treat PENDING rows in `marketing_signals` as upload backlog.

## When to use this runbook

- Evidence / health pack shows elevated `marketing_signals_pending_count` (audit pressure)
- `marketing_signals_queue_parity_gap_count > 0` when parity enforcement is `enforce`
- Ops confusion: “signal table has rows but script did not export them” → expected for audit residue; check **queue** instead

## Parity repair (site-scoped)

Finds Google-eligible `marketing_signals` rows (click id present) with no matching journal row, then calls `ensureMarketingSignalQueueParity`.

```bash
npm run oci:repair-marketing-signal-parity -- --dry-run
npm run oci:repair-marketing-signal-parity -- --dry-run --site=<site-uuid> --limit=200
npm run oci:repair-marketing-signal-parity -- --site=<site-uuid> --limit=200
```

Omit `--dry-run` only after reviewing JSON summary (`parityGaps`, `examined`).

## Verify

- Queue health / release evidence: `script_backlog_health.sql` pack (`marketing_signals_queue_parity_gap_count`)
- Export closure tests: `tests/chaos/export-dual-path-gate.test.ts` (journal-only fetch)
- Full gate: `npm run test:release-gates:pr` (local) or `npm run smoke:oci-rollout-readiness:strict` (prod DB)

## Related

- Won pipeline (separate STOP gate): [WON_PIPELINE_REPAIR.md](./WON_PIPELINE_REPAIR.md)
- Producer map: [EXPORT_CLOSURE.md](../architecture/EXPORT_CLOSURE.md) § PR-9H.6.1
