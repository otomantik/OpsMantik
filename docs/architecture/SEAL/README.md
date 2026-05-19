# SEAL-00 — Evidence pack (PR-OM-SEAL-00)

**Generated:** 2026-05-19  
**PR scope:** Documentation + evidence only. **No** route/cron/panel/ingest code changes in this PR.

## Deliverables

| File | Purpose |
|------|---------|
| [API_ROUTE_INVENTORY.md](./API_ROUTE_INVENTORY.md) | Auto-generated route list (`npm run audit:api-routes`) |
| [ROUTE_MATRIX_V2.md](./ROUTE_MATRIX_V2.md) | Security + classification + CUT decision per route group |
| [CALLER_GRAPH.md](./CALLER_GRAPH.md) | Static/fetch/test/docs/cron evidence for cut candidates |
| [CRON_CONTRACT.md](./CRON_CONTRACT.md) | Retained vs removed schedules; rollback notes |
| [ENV_FLAG_FREEZE.md](./ENV_FLAG_FREEZE.md) | Feature flags and prod defaults |
| [PII_RETENTION_AUDIT.md](./PII_RETENTION_AUDIT.md) | PII surfaces + retention SSOT |
| [PANEL_V1_CONTRACT.md](./PANEL_V1_CONTRACT.md) | Operator panel three-block contract |
| [INSTALL_CENTER_V1.md](./INSTALL_CENTER_V1.md) | Install page acceptance + status machine |
| [CUT_MANIFEST.md](./CUT_MANIFEST.md) | OUT_OF_CORE modules and cut ladder |
| [TEN_SITE_SMOKE.md](./TEN_SITE_SMOKE.md) | 10-site validation protocol |
| [STAGE_AUTHORITY.md](./STAGE_AUTHORITY.md) | **Validated** stage → queue → export → ACK paths |
| [SEAL-00_VERIFICATION.md](./SEAL-00_VERIFICATION.md) | Consistency checks + command outputs |

## Merge gate for CUT-01

**CUT-01 is blocked until this PR is merged and reviewed.**

- [ ] All deliverables above reviewed
- [ ] [SEAL-00_VERIFICATION.md](./SEAL-00_VERIFICATION.md) commands pass (audit + build; lint pre-existing noted)
- [ ] `STAGE_AUTHORITY.md` signed off (queue-backed export confirmed)
- [ ] PR description states: **SEAL-00: no prod code cuts**

### Forbidden in SEAL-00 (must be empty diff)

- `vercel.json`, `app/api/**` behavior, `public/assets/core.js`, `GoogleAdsScriptUniversal.js`, migrations, panel/ingest production code

## Execution order (approved)

SEAL-00 → CUT-01 → CUT-02 → PERF-01/02 → SEAL-01+ → panel/install
