# Env & feature flag freeze — SEAL-00

**SSOT for refactor flags:** [`lib/refactor/flags.ts`](../../../lib/refactor/flags.ts)  
**Prod template:** [`.env.local.example`](../../../.env.local.example) (verify no experimental `=true`)

## Classification

| Env / flag | Code default | Production required | Used by | Core? | Decision |
|------------|--------------|---------------------|---------|-------|----------|
| `TRUTH_SHADOW_WRITE_ENABLED` | false | **false** | ingest shadow ledger | no | PERF-01 CI assert |
| `TRUTH_TYPED_EVIDENCE_ENABLED` | false | false | truth payloads | no | off |
| `TRUTH_INFERENCE_REGISTRY_ENABLED` | false | false | inference runs | no | off |
| `IDENTITY_GRAPH_ENABLED` | false | false | graph edges | no | off |
| `TRUTH_ENGINE_CONSOLIDATED_ENABLED` | false | false | parity probes | no | off |
| `TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED` | false | false | canonical ledger | no | off |
| `CONSENT_PROVENANCE_SHADOW_ENABLED` | false | false | sync shadow | no | off |
| `EXPLAINABILITY_API_ENABLED` | false | false | `/api/truth/explain` | no | FEATURE_FLAG_ONLY |
| `SOURCE_TRUTH_SHADOW_ENABLED` | false | **false** unless per-site 10-site approval | `resolve-source-truth` | conditional | **Not SSOT until renamed** — separate PR if promoted |
| `TRUTH_PARITY_MODE` | `detect` | **`off`** in prod | parity cron | no | CUT-02 + PERF-01 |
| `LEASE_LOCK_MODE` | `lease` | `lease` | cron locks | yes | keep |
| `STRICT_MUTATION_VERSION_ENFORCE` | true | true | panel APIs | yes | keep |
| `SITE_TIMEZONE_STRICT_MODE` | true | true | dashboard TZ | yes | keep |
| `OCI_INTENT_PANEL_PRECURSOR_CONTACTED_ENABLED` | off unless set | false default | panel precursor | optional | document per site |
| `OPSMANTIK_STORAGE_CLEANUP_APPROVAL` | unset | set only when applying night batches | night-maintenance | yes (ops) | manual gate |
| `CRON_SECRET` | required | required | all crons | yes | keep |
| `OCI_API_KEY` / signing | required | required | export/ack | yes | keep |
| `CONVERSATIONS_ENABLED` | *(not in flags.ts yet)* | **false** | ingest `resolveIntentConversation` | no | PERF-01 add + default false |
| `google_ads_spend` module | absent in default sites | absent | spend routes | no | CUT-01 |

## OCI / ingest (core — must be set in prod)

| Var | Core |
|-----|------|
| `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | yes |
| `OCI_*` keys for script auth | yes |
| `CRON_SECRET` | yes |

## Rules (CUT / PERF)

1. Experimental `TRUTH_*` / funnel / CRO / conversations: **default false** in production template.
2. Spend module must not appear in default `active_modules`.
3. Future CI (SEAL-01 / PERF-02): `prod-env-template-flags.test.ts` — fail if template enables out-of-core flags.
4. Future: `hot-path-import-boundary.test.ts` — no `lib/domain/truth/*` static import from ingest when flags off.

## Mail / billing / provider (minimal core)

| Bucket | Examples | Core? |
|--------|----------|-------|
| `MAIL_*` | not centralized yet | future SEAL-08 |
| Billing crons | reconcile, invoice-freeze | yes (minimal) |
| `PROVIDER_*` | credentials routes | BREAK_GLASS seed only |
