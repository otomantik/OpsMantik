# Documentation Audit Report

**Date:** 2026-01-27  
**Auditor:** Antigravity (Senior Repo Librarian)  
**Status:** Actionable Cleanup Recommendation

## 1. Executive Summary
The current documentation repository has grown rapidly during the "War Room" phase, resulting in significant duplication and "doc drift." Many files serve as evidence for specific implementation steps (PR-HARD series) that are now merged and verified. Key API contracts (especially `/api/sync`) have changed in code but remain outdated in the docs. This report recommends a transition from "log-based" documentation to a "canonical truth" structure, archiving 60% of the current files and merging technical specifications into single authoritative sources.

## 2. Inventory Table

| File Path | Category | Last Relevance | Proposed Action | Target Location | Reason |
|:---|:---|:---|:---|:---|:---|
| `docs/ARCHITECTURE.md` | RUNBOOK | Active | **KEEP** | - | Core system overview. |
| `docs/API_STATUS_CODES.md` | REPORT | Superseded | **MERGE_INTO** | `docs/API_CONTRACT.md` | Contains outdated schemas; merge with endpoints. |
| `docs/ALL_URLS_ENDPOINTS.md` | REPORT | Superseded | **MERGE_INTO** | `docs/API_CONTRACT.md` | Redundant with status codes; consolidate. |
| `docs/CORS_MANAGEMENT.md` | NOTES | Active | **KEEP** | - | Critical security policy reference. |
| `docs/SYSTEM_STATUS_FINAL.md` | STATUS | Superseded | **ARCHIVE** | `docs/_archive/2026-01-27/` | Replaced by live system state. |
| `docs/WAR_ROOM_LOCK.md` | STATUS | Active | **KEEP+RENAME** | `docs/WAR_ROOM/STATUS.md` | Current "Savaş Odası" status. |
| `docs/SOURCE_CONTEXT_LOCK.md` | NOTES | Superseded | **ARCHIVE** | `docs/_archive/2026-01-27/` | Merged into implementation. |
| `docs/SOURCE_CONTEXT_TRUTH_TABLE.md` | NOTES | Active | **KEEP** | - | Essential logic for attribution. |
| `docs/INSTALL_WP.md` | RUNBOOK | Active | **KEEP** | - | Critical onboarding for client sites. |
| `docs/WAR_ROOM/SURGERY_PLAN.md` | REPORT | Active | **KEEP** | - | Active overhaul roadmap. |
| `docs/WAR_ROOM/TEST_0_SMOKE.md` | RUNBOOK | Active | **KEEP+RENAME** | `docs/SMOKE.md` | Canonical smoke test guide. |
| `docs/WAR_ROOM/PR*_EVIDENCE.md` | EVIDENCE | Duplicate | **ARCHIVE** | `docs/_archive/2026-01-27/` | PR specific proof; valid but redundant for daily ops. |
| `docs/WAR_ROOM/PR_HARD_*.md` | IMPLEMENTATION | Duplicate | **ARCHIVE** | `docs/_archive/2026-01-27/` | Logic now resides in code. |
| `docs/WAR_ROOM/MOBILE_ISSUES.md` | REPORT | Active | **KEEP** | - | Ongoing tracking of mobile issues. |
| `docs/WAR_ROOM/POST_OP_REPORT.md` | REPORT | Duplicate | **ARCHIVE** | `docs/_archive/2026-01-27/` | Replaced by global status. |
| `docs/WAR_ROOM/ISSUES.md` | REPORT | Superseded | **DELETE** | - | Replaced by active Issue tracker if exists or redundancy. |
| `docs/CRITICAL_ISSUES_REPORT.md` | REPORT | Superseded | **DELETE** | - | Redundant with WAR_ROOM/ISSUES. |
| `docs/EVIDENCE_CIQ.md` | EVIDENCE | Duplicate | **ARCHIVE** | `docs/_archive/2026-01-27/` | Call Intent Queue proof. |
| `docs/DEV_CHECKLIST.md` | RUNBOOK | Superseded | **DELETE** | - | Redundant with GO_LIVE_CHECKLIST. |
| `docs/GO_LIVE_CHECKLIST.md` | RUNBOOK | Active | **KEEP** | - | Pre-deployment sanity. |

## 3. "Keep Set" (Must Keep)
These files form the backbone of the repo knowledge:
1. `docs/ARCHITECTURE.md` (System design)
2. `docs/API_CONTRACT.md` (**NEW Proposed** - Consolidating URLS and Status Codes)
3. `docs/CORS_MANAGEMENT.md` (Security lockdown rules)
4. `docs/SOURCE_CONTEXT_TRUTH_TABLE.md` (Attribution logic)
5. `docs/INSTALL_WP.md` (Client implementation)
6. `docs/SMOKE.md` (Verification process)
7. `docs/WAR_ROOM/STATUS.md` (Active development state)

## 4. "Archive Set" (Safe to archive)
**Archive Path:** `docs/_archive/2026-01-27/`
*   All `PR*_EVIDENCE.md` files.
*   All `PR_HARD_*.md` implementation logs.
*   `EVIDENCE_SOURCE_CONTEXT_FINAL.md`.
*   `SYSTEM_STATUS_FINAL.md` (historical context only).

**Why safe:** These files provide "how we got here" context. They are valuable if we need to debug old logic changes but are distractions during active development.

## 5. "Delete Set" (Safe to delete)
*   `docs/DEV_CHECKLIST.md` (Superseded by GO_LIVE).
*   `docs/CRITICAL_ISSUES_REPORT.md` (Duplicate of WAR_ROOM logs).

## 6. Doc Drift (CRITICAL)

### `/api/sync` Response Schema
*   **Code:** `NextResponse.json(createSyncResponse(true, leadScore, { status: 'synced' }))` -> `{ ok: true, score: 15, status: 'synced' }`
*   **Docs say:** `{ status: "synced", score: 45 }` (in `ALL_URLS_ENDPOINTS.md` and `API_STATUS_CODES.md`).
*   **Error Drifts:** Code uses `{ ok: false, score: null, message: "..." }`. Docs show varied formats like `{ error: "...", details: "..." }`.
*   **Suggested Update:** Standardize on `{ ok, score, message|status, ... }` across all tracking-related endpoints.

### CORS Deny Semantics (PR-HARD-1.1)
*   **Code:** Returns `status: 403` AND **OMITS** `Access-Control-Allow-Origin` entirely.
*   **Docs say:** Some docs (like `API_STATUS_CODES.md` line 253) claim it returns `<origin> | *`.
*   **Suggested Update:** "ACAO MUST be absent on 403 Forbidden responses to avoid echoing malicious origins."

### OPTIONS status
*   **Code:** Preflight returns `isAllowed ? 200 : 403`.
*   **Docs say:** Most claim constant `200`.

## 7. Consolidation Plan
1.  **Canonical Index:** Create `docs/WAR_ROOM/INDEX.md` as the entry point for all tech docs.
2.  **API Source of Truth:** Create `docs/API_CONTRACT.md` by merging the valid parts of `ALL_URLS_ENDPOINTS.md` and `API_STATUS_CODES.md`, corrected for the `ok/score` schema.
3.  **Folder Cleanup:** Move all historical PR/Evidence files to `docs/_archive/2026-01-27/`.

---
**Report generated by Antigravity Librarian.** No files were touched in this step.
