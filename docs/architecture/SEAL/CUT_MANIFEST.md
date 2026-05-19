# CUT manifest — OUT_OF_CORE vs sacred (SEAL-00)

**Cut ladder (all CUT PRs):** `PROD_OFF` → caller graph → one release → `410_GONE` → `DELETE_AFTER_ONE_RELEASE`

## Sacred — never cut without Google Ads + release-gates coordination

| Area | Paths |
|------|-------|
| Tracker | `public/assets/core.js`, `npm run tracker:build` |
| OCI script | `scripts/google-ads-oci/GoogleAdsScriptUniversal.js` |
| Ingest | `/api/sync`, `/api/call-event`, `/api/call-event/v2` |
| Panel mutations | `/api/intents/*/stage`, `status`, `review`; `/api/calls/[id]/seal` |
| OCI script API | `/api/oci/google-ads-export`, `ack`, `ack-failed`, `script-heartbeat`, `v2/verify` |
| Install | `/api/sites/[siteId]/tracker-embed`, `origins/verify` |
| GDPR | `/api/gdpr/*` |
| Conversion names | `OpsMantik_Contacted`, `Offered`, `Won`, `Junk_Exclusion` |

## OUT_OF_CORE — prod surface removal (CUT-01+)

| Module | Routes / UI | Evidence | First action | Owner PR |
|--------|-------------|----------|--------------|----------|
| Google Spend | `/api/webhooks/google-spend`, `/api/dashboard/spend`, `scripts/google-ads-spend/` | 0 app refs; webhook in spend script only | PROD_OFF → 410_GONE | CUT-01 |
| Funnel / CRO | `useFunnelAnalytics`, `CROInsights`, `/api/cron/funnel-projection` | `dashboard-shell.tsx` only | Remove UI import; vercel cut CUT-02 | CUT-01/02 |
| Stats / reporting | `/api/stats/*`, `/api/reporting/dashboard-stats` | 0 panel refs; perf script optional | PROD_OFF → 410_GONE | CUT-01 |
| Truth parity | `/api/cron/truth-parity-repair`, `TRUTH_PARITY_MODE=detect` default | vercel 10m schedule | vercel remove CUT-02; flag `off` PERF-01 | CUT-02 |
| Conversations CRM | 9× `/api/conversations/*` | 0 app/component fetch; unit tests only | PROD_OFF; ARCHIVE_AFTER_EVIDENCE | SEAL-06 |
| Truth explain | `/api/truth/explain/[callId]` | flag `EXPLAINABILITY_API_ENABLED` | FEATURE_FLAG_ONLY default off | CUT-01 |
| adsmantik-engine | separate deploy | not ingest hot path | document only | — |
| Duplicate admin metrics | `/api/metrics`, `/api/admin/metrics` | 0 panel refs | ADMIN_ONLY | later |

## Cron — current vs target

**Current vercel.json:** 19 schedules (see [CRON_CONTRACT.md](./CRON_CONTRACT.md))  
**Final target:** 6 core + optional monthly `invoice-freeze`

## Code that stays in repo but leaves prod path

- Cron **handlers** remain for break-glass after vercel schedule removed (CUT-02).
- Route **files** remain after PROD_OFF until `DELETE_AFTER_ONE_RELEASE`.

## Explicit non-goals (this initiative)

- Analytics product, spend dashboards, funnel projection as operator UX
- CRM conversations in `/panel`
- Stage storage migration (`offline_conversion_queue` authority change)
- Deleting migrations or OCI FSM SQL
