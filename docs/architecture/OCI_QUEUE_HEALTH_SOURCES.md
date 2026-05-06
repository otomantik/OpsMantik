# Queue health — kaynak matrisi (Görev 1)

Operasyonel metriklerin **nereden** geldiği ve **gate** ile ilişkisi. Drift riski: aynı sayının birden fazla dosyada farklı literal olması; tekleştirme `lib/oci/queue-health-contract.ts` (TypeScript) ve `scripts/oci-rollout-readiness.ts` (contract import).

| Source | Metrics / çıktı | Thresholds | Site-scoped | DB-backed | Used by gate | Drift risk |
|--------|-----------------|------------|-------------|-----------|--------------|------------|
| [app/api/oci/queue-stats/route.ts](../../app/api/oci/queue-stats/route.ts) | Sayımlar, stuck, outbox, blocked metrics, `queue_health_*` | Contract sabitleri | yes | yes (Supabase) | ops UI | Orta → contract ile kilitlendi |
| [scripts/oci-rollout-readiness.ts](../../scripts/oci-rollout-readiness.ts) | Çok site: queue/outbox sayıları, retry/failed oranı, stuck | `ROLLOUT_PROFILE_DEFAULTS` + CLI override | yes (per site) | yes | `smoke:oci-rollout-readiness:strict`, release | Orta → contract ile kilitlendi |
| [scripts/sql/script_backlog_health.sql](../../scripts/sql/script_backlog_health.sql) | `offline_conversion_queue_active_count`, yaşlar | SLO yorumda / pack | yes | yes (read SQL) | verify-db, evidence | Düşük (pack contract) |
| [scripts/sql/won_pipeline_health.sql](../../scripts/sql/won_pipeline_health.sql) | `won_missing_pipeline`, leak | RED if missing > 0 | yes | yes | verify-db, evidence | Düşük |
| [scripts/sql/oci_time_ssot_health.sql](../../scripts/sql/oci_time_ssot_health.sql) | time drift `contract_status` | RED kolaylığı | surface | yes | verify-db | Düşük |
| [scripts/sql/value_integrity_health.sql](../../scripts/sql/value_integrity_health.sql) | value drift | policy_version | global/site | yes | verify-db | Düşük |
| [scripts/sql/identity_integrity_health.sql](../../scripts/sql/identity_integrity_health.sql) | hash integrity | RED counters | yes | yes | verify-db | Düşük |
| [scripts/sql/queue_health.sql](../../scripts/sql/queue_health.sql) | Birleşik queue health satırı, `policy_version`, blocking | Contract ile aynı eşik yorumları | yes | yes | verify-db, evidence | Yeni — düşük |
| [scripts/release/collect-gate-evidence.mjs](../../scripts/release/collect-gate-evidence.mjs) | STATIC vs TARGET artifact, `db_evidence_status` | Mod tabanlı | no | opsiyonel | release:evidence | Orta — K1 alanları |
| [scripts/release/evidence-contracts.mjs](../../scripts/release/evidence-contracts.mjs) | HEALTH_PACK listesi, hash | expected_columns | no | no (dosya) | static verify | Düşük |
| [app/api/metrics/route.ts](../../app/api/metrics/route.ts) | (varsa genel metrikler) | — | — | — | opsiyonel | — |

**Not:** “Queue Health 100” kemik tanımı (stuck=0, DLQ=0, …) rollout toleranslı eşiklerinden (`stuckMax` 20 vb.) farklıdır; ikisi aynı raporda karıştırılmaz.
