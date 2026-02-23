# OpsMantik Documentation — LLM Index

This is the canonical documentation hub for the OpsMantik platform. Use this index to locate design decisions, runbooks, evidence, and sprint context.

---

## Table of Contents

| Folder | Purpose |
|--------|---------|
| **[architecture/](architecture/)** | Core system design, schemas, ADRs, and standards |
| **[runbooks/](runbooks/)** | Deployment, testing, and operational guides |
| **[evidence/](evidence/)** | Proof of work, smoke-test logs, and execution evidence |
| **[sprints/](sprints/)** | Current active sprint planning and checklists |
| **[archive/](archive/)** | Historical context (old sprints, legacy reports, deprecated plans) |

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
| [AUDIT/](architecture/AUDIT/) | Tenant scope guard, ingestion durability, tier audits |

---

## runbooks/

**Operational procedures for deployment, incidents, and testing.**

| Document | Description |
|----------|-------------|
| [REVENUE_KERNEL_RELEASE_RUNBOOK.md](runbooks/REVENUE_KERNEL_RELEASE_RUNBOOK.md) | Revenue kernel release steps |
| [QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md](runbooks/QUOTA_CALL_EVENT_INCIDENT_RUNBOOK.md) | Quota/call-event incident response |
| [PROVIDERS_UPLOAD_RUNBOOK.md](runbooks/PROVIDERS_UPLOAD_RUNBOOK.md) | Provider credential upload |
| [DEPLOY_SYNC_429_SITE_SCOPED_RL.md](runbooks/DEPLOY_SYNC_429_SITE_SCOPED_RL.md) | Sync 429 rate-limit deployment |
| [DEPLOY_CHECKLIST_REVENUE_KERNEL.md](runbooks/DEPLOY_CHECKLIST_REVENUE_KERNEL.md) | Revenue kernel deploy checklist |
| [FAILURE_DRILL_PLAN.md](runbooks/FAILURE_DRILL_PLAN.md) | Failure drill procedures |
| [GOOGLE_ADS_TRACKING_TEMPLATE.md](runbooks/GOOGLE_ADS_TRACKING_TEMPLATE.md) | Google Ads tracking template |
| [TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md](runbooks/TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md) | Temporary quota unblock procedure |
| [RUNBOOK_QSTASH_DEGRADED_PROOF.md](runbooks/RUNBOOK_QSTASH_DEGRADED_PROOF.md) | QStash degraded-mode proof |
| [PR_GATE_WATCHTOWER_BUILDINFO.md](runbooks/PR_GATE_WATCHTOWER_BUILDINFO.md) | Watchtower build-info PR gate |

---

## evidence/

**Proof of work, smoke-test logs, and execution evidence.**

| Category | Contents |
|----------|----------|
| **Proof logs** | CRON_BULK_NONZERO_PROOF, cron-bulk-nonzero-proof.log |
| **Implementation evidence** | REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE |
| **i18n / dashboards** | I18N_* reports, GLOBAL_SAAS_ANALYSIS_2026 |

---

## sprints/

**Current active sprint planning.**

| Document | Description |
|----------|-------------|
| [GLOBAL_SAAS_READINESS_TECH_DEBT_REPORT.md](sprints/GLOBAL_SAAS_READINESS_TECH_DEBT_REPORT.md) | Tech debt for global SaaS readiness |
| [LIVE_QUEUE_EVENT_CHECKLIST.md](sprints/LIVE_QUEUE_EVENT_CHECKLIST.md) | Live queue event checklist |

---

## archive/

**Historical context. Do not use for active development.**

### Archive Summary (for LLMs)

The `archive/` folder contains:

- **root-legacy/**: Old sprint notes (I18N, GDPR, compliance, conversation layer), diagnostic checklists (SYNC_400, SQL_INTENT), and market reports (SAAS_PUAN_RAPORU, OCI_DURUM_RAPORU, OPSMANTIK_URUN_PAZAR_RAPORU).
- **OPS-legacy/**: Past PR reports (PR8A, PR9, PR10, PR11, PR-C1, PR-C4, PR17), code quality audits, vault/credentials notes, G1/G5 status, revenue kernel status reports.
- **AUDIT-legacy/**: Legacy system audit reports.
- **historical-missions/**: Deploy checklists, audit scans, cleanup backlogs, system scans, rollout plans, hardening notes.
- **2026-02-02/**: WAR_ROOM evidence, root-exports, audit-ad-hoc SQL, diagnostic queries.

Use `archive/` when you need historical decisions, past sprint context, or deprecated designs. For current architecture and runbooks, use `architecture/` and `runbooks/`.

---

## Documentation Policy

**All active documentation MUST be written in Professional English.**  
The `archive/` directory contains legacy mixed-language files which are not to be translated.

---

## Critical Standards

- **Language**: Active documentation must be in **Professional English**.
- **Change control**: Breaking architecture or API changes must be reflected here before deployment.
