# OCI operator index (single entry)

Start here for production OCI operations:

1. **Allowlist (do not break):** [`../OCI_CORE_ALLOWLIST.md`](../OCI_CORE_ALLOWLIST.md)
2. **Cron schedules:** [`CRON_VERCEL_MATRIX.md`](./CRON_VERCEL_MATRIX.md)
3. **Public script contract:** [`PUBLIC_SCRIPT_API_CONTRACT.md`](./PUBLIC_SCRIPT_API_CONTRACT.md)
4. **Chaos ↔ routes:** [`CHAOS_TEST_ROUTE_MAP.md`](./CHAOS_TEST_ROUTE_MAP.md)
5. **Hot path idempotency:** [`PERF_IDEMPOTENCY_HOT_PATHS.md`](./PERF_IDEMPOTENCY_HOT_PATHS.md)
6. **Threat model:** [`THREAT_MODEL_API_SURFACE.md`](./THREAT_MODEL_API_SURFACE.md)

**Smoke:** `npm run smoke:oci-rollout-readiness:strict` (deploy gate).

**Scripts:** see [`MINIMUM_OPERATION_SCRIPTS.md`](./MINIMUM_OPERATION_SCRIPTS.md).
