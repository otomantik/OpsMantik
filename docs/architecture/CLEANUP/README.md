# Deep slimdown — documentation index

Artifacts created for the **Derin temizlik** program (Faz 0–S, Ultra T–W, Hyper X–AA). The plan file itself lives in Cursor plans; this folder is the repo **source of truth** for inventories and runbooks.

| Doc | Phase |
|-----|--------|
| [`../CLEANUP_BASELINE.md`](../CLEANUP_BASELINE.md) | Faz 0 |
| [`../OCI_CORE_ALLOWLIST.md`](../OCI_CORE_ALLOWLIST.md) | Faz 0 |
| [`API_ROUTE_INVENTORY.md`](./API_ROUTE_INVENTORY.md) | Faz B |
| [`CORS_AND_MIDDLEWARE_NOTES.md`](./CORS_AND_MIDDLEWARE_NOTES.md) | Faz H |
| [`LIB_LAYER_MAP.md`](./LIB_LAYER_MAP.md) | Faz C |
| [`CRON_VERCEL_MATRIX.md`](./CRON_VERCEL_MATRIX.md) | Faz G |
| [`RUNTIME_API_TOPOLOGY.md`](./RUNTIME_API_TOPOLOGY.md) | Faz L |
| [`ENV_VARS_MATRIX.md`](./ENV_VARS_MATRIX.md) | Faz N |
| [`INTEGRATIONS_THIRD_PARTY.md`](./INTEGRATIONS_THIRD_PARTY.md) | Faz K |
| [`DB_TABLE_RPC_INVENTORY.md`](./DB_TABLE_RPC_INVENTORY.md) | Faz F |
| [`POSTGRES_DEEP_OBJECTS.md`](./POSTGRES_DEEP_OBJECTS.md) | Faz M |
| [`GDPR_RETENTION_MAP.md`](./GDPR_RETENTION_MAP.md) | Faz Q |
| [`GOVERNANCE_ADR_AND_ROLLBACK.md`](./GOVERNANCE_ADR_AND_ROLLBACK.md) | Faz R |
| [`OCI_OPERATOR_INDEX.md`](./OCI_OPERATOR_INDEX.md) | Faz I |
| [`THREAT_MODEL_API_SURFACE.md`](./THREAT_MODEL_API_SURFACE.md) | Faz T |
| [`PERF_IDEMPOTENCY_HOT_PATHS.md`](./PERF_IDEMPOTENCY_HOT_PATHS.md) | Faz U |
| [`TRUST_BCP_AND_EMAIL.md`](./TRUST_BCP_AND_EMAIL.md) | Faz V |
| [`CODE_QUALITY_SIGNALS.md`](./CODE_QUALITY_SIGNALS.md) | Faz W |
| [`MIZAN_MANTIK_LEGACY.md`](./MIZAN_MANTIK_LEGACY.md) | Knip / legacy domain |
| [`PUBLIC_SCRIPT_API_CONTRACT.md`](./PUBLIC_SCRIPT_API_CONTRACT.md) | Faz X |
| [`SECURITY_HEADERS_INVENTORY.md`](./SECURITY_HEADERS_INVENTORY.md) | Faz Y |
| [`SBOM_AND_LICENSE_POLICY.md`](./SBOM_AND_LICENSE_POLICY.md) | Faz Z |
| [`CHAOS_TEST_ROUTE_MAP.md`](./CHAOS_TEST_ROUTE_MAP.md) | Faz AA |
| [`SUPPLY_CHAIN_NOTES.md`](./SUPPLY_CHAIN_NOTES.md) | Faz O |
| [`I18N_AND_ENTITLEMENTS_PRODUCT.md`](./I18N_AND_ENTITLEMENTS_PRODUCT.md) | Faz J |
| [`OBSERVABILITY_AFTER_SENTRY_BUILD.md`](./OBSERVABILITY_AFTER_SENTRY_BUILD.md) | Faz P |
| [`PUBLIC_ASSETS_AND_CI.md`](./PUBLIC_ASSETS_AND_CI.md) | Faz S |
| [`MINIMUM_OPERATION_SCRIPTS.md`](./MINIMUM_OPERATION_SCRIPTS.md) | Faz E |

Regenerate API inventory: `npm run audit:api-routes`.
