# OCI / panel threat model (STRIDE subset)

| Threat | Mitigation today | Residual |
|--------|------------------|----------|
| **Spoofing** (cron) | `requireCronAuth` + Vercel cron header | New cron routes must copy the pattern |
| **Tampering** (cross-tenant) | `validateSiteAccess`, RLS on user paths, admin reads scoped by `call_id` | Regression if a route trusts client `site_id` |
| **Repudiation** | `call_funnel_ledger`, causal DNA queue, truth shadow | Shadow off by flag → weaker audit |
| **Information disclosure** | Sanitized API errors, phone hashing SSOT | Admin metrics need auth |
| **DoS** | Rate limits on ingest, cron distributed locks | Heavy RPC batches need limits |
| **Elevation** (seal / stage) | `calls.version` + `apply_call_action_v1` when `p_version` set | `p_version null` skips check (legacy); panel now sends version |

## Operational secrets

- `VOID_LEDGER_SALT`, `OCI_PHONE_HASH_SALT`, `CRON_SECRET` — production must be set (see `docs/GLOBAL_LAUNCH_CHECKLIST.md`).
