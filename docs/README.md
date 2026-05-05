# OpsMantik Documentation — Index

Canonical documentation hub. Use this index to locate design contracts,
runbooks, and evidence. Historical per-site forensic notes, one-shot audits,
and phase-specific deploy checklists were pruned in the Phase 5 cleanup — the
authoritative architectural contracts remain, and the pre-launch runbook set
is now small enough to read end-to-end before a cutover.

## OCI Conversion Time (Zero Tolerance)

All OCI paths are required to use first intent creation timestamp as conversion time SSOT.

- Policy document: [OPS/OCI_CONVERSION_TIME_ZERO_TOLERANCE.md](OPS/OCI_CONVERSION_TIME_ZERO_TOLERANCE.md)
- This policy is fail-closed and release-blocking.

---

## Folders

| Folder | Purpose |
|--------|---------|
| [overview/](overview/) | Platform overview, system brief |
| [architecture/](architecture/) | System contracts, schemas, ADRs |
| [operations/](operations/) | Live operations snapshots |
| [runbooks/](runbooks/) | Deploy, incident, and drill procedures |
| [OPS/](OPS/) | Deploy gates, ingest contract, OCI ops SOPs |
| [evidence/](evidence/) | Proof-of-work and execution evidence |
| [security/](security/) | Compliance gates |
| [sprints/](sprints/) | Active planning artifacts |
| [GLOBAL_LAUNCH_CHECKLIST.md](GLOBAL_LAUNCH_CHECKLIST.md) | Pre-launch gate for the first non-TR customer |

---

## architecture/ — Canonical contracts

| Document | Description |
|----------|-------------|
| [ARCH.md](architecture/ARCH.md) | System design, partitioning, real-time engine |
| [API.md](architecture/API.md) | Endpoint definitions, schemas, CORS |
| [SECURITY.md](architecture/SECURITY.md) | PII scrubbing, RLS, hardening rules |
| [SETUP.md](architecture/SETUP.md) | Local dev setup, environment config |
| [OPS.md](architecture/OPS.md) | SLA/SLO, Watchtower, ops overview |
| [DETERMINISM_CONTRACT.md](architecture/DETERMINISM_CONTRACT.md) | Replay & hash-chain determinism rules |
| [EXPORT_CONTRACT.md](architecture/EXPORT_CONTRACT.md) | OCI → Google Ads export shape |
| [FUNNEL_CONTRACT.md](architecture/FUNNEL_CONTRACT.md) | Funnel kernel event-sourcing contract |
| [OCI_VALUE_ENGINES_SSOT.md](architecture/OCI_VALUE_ENGINES_SSOT.md) | Canonical stage-base × quality-factor math |
| [OCI_QUEUE_HEALTH.md](architecture/OCI_QUEUE_HEALTH.md) | Queue statuses and health gates |
| [DB_TRIGGER_ORDER.md](architecture/DB_TRIGGER_ORDER.md) | Trigger firing order reference |
| [MODULE_BOUNDARIES.md](architecture/MODULE_BOUNDARIES.md) | Where ingest/OCI/funnel code lives |
| [PRECISION_LOGIC_RUNBOOK.md](architecture/PRECISION_LOGIC_RUNBOOK.md) | Precision-logic normalization reference |
| [PROJECTION_REDUCER_SPEC.md](architecture/PROJECTION_REDUCER_SPEC.md) | Projection reducer contract |
| [MASTER_ARCHITECTURE_MAP.md](architecture/MASTER_ARCHITECTURE_MAP.md) | High-level component map |
| [adr/](architecture/adr/) | Architecture Decision Records |
| [SECURITY/RBAC.md](architecture/SECURITY/RBAC.md) | Role-based access control |
| [SECURITY/SSO_ROADMAP.md](architecture/SECURITY/SSO_ROADMAP.md) | SSO roadmap |
| [BILLING/](architecture/BILLING/) | Revenue kernel spec, master plan |
| [OPS/OBSERVABILITY_BASELINE.md](architecture/OPS/OBSERVABILITY_BASELINE.md) | Metric checklist, CI timing |
| [OPS/OBSERVABILITY_METRIC_SOURCES.md](architecture/OPS/OBSERVABILITY_METRIC_SOURCES.md) | Requirements → logs/metrics |
| [OPS/SENTRY_INVESTIGATION.md](architecture/OPS/SENTRY_INVESTIGATION.md) | Sentry saved searches & tags |
| [OPS/SLO_SLA.md](architecture/OPS/SLO_SLA.md) | SLO/SLA targets |

---

## runbooks/ — Active procedures only

| Document | Description |
|----------|-------------|
| [DEPLOY_POST_VERIFY.md](runbooks/DEPLOY_POST_VERIFY.md) | 2-minute post-deploy verification |
| [MIGRATION_ROLLBACK.md](runbooks/MIGRATION_ROLLBACK.md) | DB migration rollback procedure |
| [FAILURE_DRILL_PLAN.md](runbooks/FAILURE_DRILL_PLAN.md) | Failure-drill cadence & targets |
| [OPERATIONAL_DRILLS.md](runbooks/OPERATIONAL_DRILLS.md) | Tabletop drills (sync, OCI, rollback) |
| [INFRA_REDIS_QSTASH_CHECKLIST.md](runbooks/INFRA_REDIS_QSTASH_CHECKLIST.md) | Redis & QStash incident checklist |
| [PROVIDERS_UPLOAD_RUNBOOK.md](runbooks/PROVIDERS_UPLOAD_RUNBOOK.md) | Provider credential upload |
| [SYNC_RATE_LIMIT_AND_QUOTA_DEFAULTS.md](runbooks/SYNC_RATE_LIMIT_AND_QUOTA_DEFAULTS.md) | Sync rate-limit tuning defaults |
| [AUTH_LOGIN_REDIRECT_TROUBLESHOOTING.md](runbooks/AUTH_LOGIN_REDIRECT_TROUBLESHOOTING.md) | Auth/login redirect triage |
| [TRACKER_CORS_SCRIPT_UPDATE.md](runbooks/TRACKER_CORS_SCRIPT_UPDATE.md) | Tracker script + CORS update SOP |
| [OCI_GOOGLE_ADS_SCRIPT_CONTROL.md](runbooks/OCI_GOOGLE_ADS_SCRIPT_CONTROL.md) | Google Ads OCI script quarantine SOP |
| [OCI_GCLID_CAPTURE_FLOW.md](runbooks/OCI_GCLID_CAPTURE_FLOW.md) | GCLID capture flow reference |
| [OCI_CONVERSION_INTENT_FLOW_DIAGRAM.md](runbooks/OCI_CONVERSION_INTENT_FLOW_DIAGRAM.md) | UI → conversion mapping |
| [GOOGLE_ADS_TRACKING_TEMPLATE.md](runbooks/GOOGLE_ADS_TRACKING_TEMPLATE.md) | Google Ads tracking template |
| [GITHUB_RELEASE_GATES_REQUIRED_CHECK.md](runbooks/GITHUB_RELEASE_GATES_REQUIRED_CHECK.md) | Required-check setup for release gates |
| [RUNBOOK_QSTASH_DEGRADED_PROOF.md](runbooks/RUNBOOK_QSTASH_DEGRADED_PROOF.md) | QStash degraded-mode proof |
| [QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md](runbooks/QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md) | Quota / call-event incident response |

---

## OPS/ — Deploy gates & OCI ops SOPs

| Document | Description |
|----------|-------------|
| [DEPLOY_GATE_INTENT.md](OPS/DEPLOY_GATE_INTENT.md) | Mandatory smoke gate before every deploy |
| [INGEST_CONTRACT.md](OPS/INGEST_CONTRACT.md) | Ingest lane contract |
| [DIC_ECL_UTF8_ENCODING.md](OPS/DIC_ECL_UTF8_ENCODING.md) | DIC / Enhanced Conversions UTF-8 contract |
| [OCI_CONTROL_SMOKE.md](OPS/OCI_CONTROL_SMOKE.md) | OCI control-plane smoke procedure |
| [OCI_ATTEMPT_CAP.md](OPS/OCI_ATTEMPT_CAP.md) | Retry-cap governance |
| [OCI_SCRIPT_DEPLOYMENT.md](OPS/OCI_SCRIPT_DEPLOYMENT.md) | Google Ads OCI script deployment steps |
| [ATTRIBUTION_FORENSIC_LAYER.md](OPS/ATTRIBUTION_FORENSIC_LAYER.md) | Attribution forensic reference |
| [PROBE_INTEGRATION_GEMINI_BRIEFING.md](OPS/PROBE_INTEGRATION_GEMINI_BRIEFING.md) | Android probe integration brief |

---

## evidence/ — Proof of work

Smoke-test logs, implementation evidence, i18n audit.

---

## sprints/

| Document | Description |
|----------|-------------|
| [GLOBAL_SAAS_READINESS_TECH_DEBT_REPORT.md](sprints/GLOBAL_SAAS_READINESS_TECH_DEBT_REPORT.md) | Tech debt for global SaaS readiness |
| [LIVE_QUEUE_EVENT_CHECKLIST.md](sprints/LIVE_QUEUE_EVENT_CHECKLIST.md) | Live queue event checklist |

---

## Documentation policy

- **Language**: English only.
- **Canonical stages**: `contacted` / `offered` / `won` / `junk`. No Turkish stage names in new docs. If you encounter `gorusuldu`/`teklif`/`satis` in the wild, it is a historical artefact — not the canonical name.
- **Neutral defaults**: `USD` and `UTC` are the documented neutral defaults; per-site values come from `sites.currency` and `sites.timezone`.
- **Change control**: Breaking architecture or API changes must land here before deployment.
