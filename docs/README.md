# OpsMantik Documentation — LLM Index

This is the canonical documentation hub for the OpsMantik platform. Use this index to locate design decisions, runbooks, evidence, and sprint context.

---

## Table of Contents

| Folder | Purpose |
|--------|---------|
| **[overview/](overview/)** | Platform overview, system brief (onboarding, investors) |
| **[architecture/](architecture/)** | Core system design, contracts, schemas, standards |
| **[operations/](operations/)** | Live operations snapshot (OCI, metrics) |
| **[runbooks/](runbooks/)** | Deployment, incident, and testing procedures |
| **[OPS/](OPS/)** | Deploy gates, ingest contract, OCI ops |
| **[evidence/](evidence/)** | Proof of work and execution evidence |
| **[sprints/](sprints/)** | Active sprint planning (if in use) |

---

## architecture/

**Core system design and standards.**

| Document | Description |
|----------|-------------|
| [ARCH.md](architecture/ARCH.md) | System design, partitioning, real-time engine overview |
| [API.md](architecture/API.md) | Endpoint definitions, request/response schemas, CORS |
| [SECURITY.md](architecture/SECURITY.md) | PII scrubbing, RLS policies, hardening rules |
| [SETUP.md](architecture/SETUP.md) | Local dev setup, environment config, site integration |
| [OPS.md](architecture/OPS.md) | SLA/SLO, monitoring (Watchtower), high-level ops |
| [SECURITY/RBAC.md](architecture/SECURITY/RBAC.md) | Role-based access control |
| [SECURITY/SSO_ROADMAP.md](architecture/SECURITY/SSO_ROADMAP.md) | SSO roadmap |
| [BILLING/](architecture/BILLING/) | Revenue kernel spec, master plan, idempotency |
| [OPS/](architecture/OPS/) | Scaling ingest idempotency, call-event DB, observability, SLO/SLA |
| [OPS/OBSERVABILITY_BASELINE.md](architecture/OPS/OBSERVABILITY_BASELINE.md) | Metric checklist (baseline), CI timing table |
| [OPS/OBSERVABILITY_METRIC_SOURCES.md](architecture/OPS/OBSERVABILITY_METRIC_SOURCES.md) | Requirements → logs/metrics mapping |
| [OPS/SENTRY_INVESTIGATION.md](architecture/OPS/SENTRY_INVESTIGATION.md) | Sentry saved searches & tags |
| [MODULE_BOUNDARIES.md](architecture/MODULE_BOUNDARIES.md) | Where ingest/OCI/funnel code lives |
| [adr/](architecture/adr/) | Architecture Decision Records |
| [AUDIT/](architecture/AUDIT/) | Tenant scope guard, ingestion durability, tier audits |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | Flaky policy, contract tests, integration strategy |
| [ONBOARDING.md](ONBOARDING.md) | New developer setup |
| [security/COMPLIANCE_CHANGE_GATE.md](security/COMPLIANCE_CHANGE_GATE.md) | GDPR/consent PR checklist |

---

## runbooks/

**Operational procedures for deployment, incidents, and testing.**

| Document | Description |
|----------|-------------|
| [REVENUE_KERNEL_RELEASE_RUNBOOK.md](runbooks/REVENUE_KERNEL_RELEASE_RUNBOOK.md) | Revenue kernel release steps |
| [QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md](runbooks/QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md) | Quota/call-event incident response |
| [PROVIDERS_UPLOAD_RUNBOOK.md](runbooks/PROVIDERS_UPLOAD_RUNBOOK.md) | Provider credential upload |
| [DEPLOY_SYNC_429_SITE_SCOPED_RL.md](runbooks/DEPLOY_SYNC_429_SITE_SCOPED_RL.md) | Sync 429 rate-limit deployment |
| [OPERATIONAL_DRILLS.md](runbooks/OPERATIONAL_DRILLS.md) | Tabletop drills (sync, OCI, rollback) |
| [INFRA_REDIS_QSTASH_CHECKLIST.md](runbooks/INFRA_REDIS_QSTASH_CHECKLIST.md) | Redis & QStash incident checklist |
| [DEPLOY_POST_VERIFY.md](runbooks/DEPLOY_POST_VERIFY.md) | Post-deploy 2-minute verification |
| [DEPLOY_CHECKLIST_REVENUE_KERNEL.md](runbooks/DEPLOY_CHECKLIST_REVENUE_KERNEL.md) | Revenue kernel deploy checklist |
| [FAILURE_DRILL_PLAN.md](runbooks/FAILURE_DRILL_PLAN.md) | Failure drill procedures |
| [GOOGLE_ADS_TRACKING_TEMPLATE.md](runbooks/GOOGLE_ADS_TRACKING_TEMPLATE.md) | Google Ads tracking template |
| [TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md](runbooks/TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md) | Temporary quota unblock procedure |
| [RUNBOOK_QSTASH_DEGRADED_PROOF.md](runbooks/RUNBOOK_QSTASH_DEGRADED_PROOF.md) | QStash degraded-mode proof |
| [PR_GATE_WATCHTOWER_BUILDINFO.md](runbooks/PR_GATE_WATCHTOWER_BUILDINFO.md) | Watchtower build-info PR gate |
| [TENANT_BOUNDARY_ADVERSARIAL_GATE.md](runbooks/TENANT_BOUNDARY_ADVERSARIAL_GATE.md) | Cross-site mutation adversarial test gate |
| [OCI_KERNEL_ADVERSARIAL_GATE.md](runbooks/OCI_KERNEL_ADVERSARIAL_GATE.md) | OCI export/runner/recovery adversarial gate |
| [GITHUB_RELEASE_GATES_REQUIRED_CHECK.md](runbooks/GITHUB_RELEASE_GATES_REQUIRED_CHECK.md) | GitHub required-check setup for release gates |
| [OCI_GOOGLE_ADS_SCRIPT_CONTROL.md](runbooks/OCI_GOOGLE_ADS_SCRIPT_CONTROL.md) | Google Ads OCI script troubleshooting and quarantine SOP |
| [OCI_SYSTEM_DEEP_ANALYSIS.md](runbooks/OCI_SYSTEM_DEEP_ANALYSIS.md) | OCI 5 sets, dual-head, flow analysis |
| [OCI_CONVERSION_INTENT_FLOW_DIAGRAM.md](runbooks/OCI_CONVERSION_INTENT_FLOW_DIAGRAM.md) | UI → conversion mapping |
| [CONVERSION_LOGIC_ERRORS_RUNBOOK.md](runbooks/CONVERSION_LOGIC_ERRORS_RUNBOOK.md) | Conversion logic errors and value SSOT |
| [CONVERSION_SIGNAL_STATUS_REPORT.md](runbooks/CONVERSION_SIGNAL_STATUS_REPORT.md) | Conversion signal status (see OCI_OPERATIONS_SNAPSHOT) |

---

## evidence/

**Proof of work, smoke-test logs, and execution evidence.**

| Category | Contents |
|----------|----------|
| **Proof logs** | CRON_BULK_NONZERO_PROOF, cron-bulk-nonzero-proof.log |
| **Implementation evidence** | REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE |
| **i18n** | I18N_EVIDENCE (consolidated i18n audit) |

---

## sprints/

**Current active sprint planning.**

| Document | Description |
|----------|-------------|
| [GLOBAL_SAAS_READINESS_TECH_DEBT_REPORT.md](sprints/GLOBAL_SAAS_READINESS_TECH_DEBT_REPORT.md) | Tech debt for global SaaS readiness |
| [LIVE_QUEUE_EVENT_CHECKLIST.md](sprints/LIVE_QUEUE_EVENT_CHECKLIST.md) | Live queue event checklist |

---

## Documentation Policy

All documentation is in English. Breaking architecture or API changes must be reflected here before deployment.

---

## Critical Standards

- **Language**: Active documentation must be in **Professional English**.
- **Change control**: Breaking architecture or API changes must be reflected here before deployment.
