# PII & retention audit — SEAL-00

**Retention SSOT:** [`docs/architecture/OPS/STORAGE_RETENTION_MATRIX.md`](../OPS/STORAGE_RETENTION_MATRIX.md)  
**GDPR routes:** [`docs/architecture/CLEANUP/GDPR_RETENTION_MAP.md`](../CLEANUP/GDPR_RETENTION_MAP.md)

## Data matrix

| Data | Stored where | PII? | Retention policy | GDPR export | Erasable | Redaction |
|------|--------------|------|------------------|-------------|----------|-----------|
| Raw phone | `calls.caller_phone_raw` | yes | life of call + GDPR batch | via `/api/gdpr/export` | `/api/gdpr/erase` | logs, mail, DLQ |
| E.164 | `calls.caller_phone_e164` | yes | same | same | same | same |
| SHA-256 phone | `calls.caller_phone_hash_sha256` | pseudonymous | same | metadata | partial | never log raw |
| Session IP / UA | `sessions` | yes | 90d consent-less anonymize | export | anonymize | GDPR cron / night |
| Event metadata | `events.metadata` | maybe | 90d anonymize | export | anonymize | — |
| Export payload | script JSON | must be hash only | ephemeral | no | n/a | **no raw phone** |
| Queue row | `offline_conversion_queue.user_identifiers` | hash only | 90d terminal cleanup | no | archive | export preview aggregates only |
| DLQ | `sync_dlq` / replay | risk | manual audit | no | purge | **SEAL-08** extend guards |
| `processed_signals` | PK / metadata | low | 90d delete batch | no | delete | night-maintenance |
| `oci_queue_transitions` | audit | low | cascade with queue | no | no | — |
| `mail_events` | future | yes if misused | TBD | export policy TBD | TBD | subject/body guards |

## Surface audit (SEAL-00)

| Surface | Raw phone risk | Evidence | Gate |
|---------|----------------|----------|------|
| Logs | medium | `rg caller_phone_raw lib app` — review hits | extend PII log CI |
| Mail | not centralized | TRUST_BCP empty | `mail-template-pii-guard` (future) |
| DLQ | medium | sync dlq routes | redaction review |
| Debug routes | high if exposed | `assertNotProductionDeployment` on test-oci, debug, create-test-site | `dev-api-production-guard.test.ts` |
| Browser / tracker | must not send raw to script | core.js contract | PUBLIC_SCRIPT_API_CONTRACT |
| Apps Script | must not hash raw | Universal.js | script contract tests |
| Panel card | Today Desk hides raw on list | panel-feed | PANEL_V1_CONTRACT |

## Hash provenance

- Server: [`lib/dic/phone-hash.ts`](../../../lib/dic/phone-hash.ts)
- Journal: `caller_phone_hash_sha256` → `user_identifiers` via [`enqueue-intent-conversion-journal-row.ts`](../../../lib/oci/enqueue-intent-conversion-journal-row.ts)
- Export diagnostics: `hashed_phone_source_counts` on export route (no raw gclid in preview)

## Tests (existing / planned)

| Test | Status |
|------|--------|
| `tests/unit/reconciliation-payload-pii-guard.test.ts` | keep |
| `tests/unit/dev-api-production-guard.test.ts` | keep |
| `tests/unit/export-payload-raw-phone-guard.test.ts` | **planned** SEAL-01 |
| `tests/unit/mail-template-pii-guard.test.ts` | **planned** SEAL-08 |

## Upload identity (cross-ref)

See [STAGE_AUTHORITY.md](./STAGE_AUTHORITY.md) and plan Upload Identity Policy — raw phone only → block export.
