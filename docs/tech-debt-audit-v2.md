# Tech Debt Audit V2: Diagnostic Report (RE-SCAN)

**Date:** 2026-02-27  
**Architect:** Antigravity (Principal Software Architect)  
**Status:** Updated after OCI Recovery Patch.

---

## 🔴 CRITICAL (Bleeding Wounds)
*Fix immediately. Imminent risk to production stability or severe performance drain.*

### 1. God Hooks: The "600-Line Anchors" (IMPROVED BUT CRITICAL)
Both `use-realtime-dashboard.ts` and `use-queue-controller.ts` have been reduced by ~10% (from 700 to 626 and 632 to 565 respectively). However, they remain massive "God Objects" that anchor the frontend velocity.
*   **Location:** `lib/hooks/use-realtime-dashboard.ts` (626 lines) and `use-queue-controller.ts` (565 lines).
*   **Risk:** High maintenance cost. Modification in one section (e.g., polling) can break unrelated sections (e.g., classification logic).
*   **Enterprise Fix:** Break these into composite hooks (e.g., `useDashboardPolling`, `useAdsClassification`, `useQueueData`).

---

## 🟡 WARNING (Spaghetti & Tech Debt)
*Needs refactoring this sprint. Development velocity is hurt.*

### 1. Brittle Silent Fails (PERSISTING)
Multiple `catch { /* ignore */ }` blocks remain in critical data hooks. 
*   **Locations:** `use-realtime-dashboard.ts:598`, `use-queue-controller.ts:123`, `use-queue-controller.ts:342`.
*   **Risk:** We are blind to RPC failures in production.
*   **Enterprise Fix:** Replace empty catch blocks with structured logging (e.g., `logger.error` or Sentry capture).

### 2. Type Safety: `any` Contagion (PERSISTING)
Core services (`pipeline-service.ts`, `conversion-service.ts`) still rely on `any` for complex data structures.
*   **Risk:** Runtime errors that TypeScript should prevent.
*   **Enterprise Fix:** Implement full interface coverage for all internal job payloads.

---

## ✅ RESOLVED / IMPROVED
*Recent changes that successfully mitigated previously flagged rot.*

### 1. OCI Recovery Ghosting (PATCHED)
The `get_and_claim_fallback_batch` RPC has been hardened with an explicit filter for `oci_sync_method = 'api'`. 
*   **Migration:** `20260309000000_fix_oci_recovery_routing.sql`.
*   **Impact:** Recovery worker now respects Explicit Routing partitioning, ignored script-based sites.

### 2. RSC Fetching Waterfalls (RESOLVED)
The sequential `await` patterns in `app/dashboard/site/[siteId]/page.tsx` have been refactored using `Promise.all`.
*   **Impact:** Drastic reduction in initial page load TTFB.

### 3. Performance Indexes (RESOLVED)
Migration `20260307000001_audit_performance_indexes.sql` successfully added composite indexes for `site_id + status`.
*   **Impact:** Faster dashboard filtering and visitor history lookups.

---

## Optimization & Architecture Review

*   **QStash Worker:** Signature verification is solid. The `DedupSkipError` pattern is a best practice.
*   **OCI Routing:** Partitioning via `oci_sync_method` is now fully reinforced by the database layer.

**Final Verdict:** The codebase is stabilizing. The OCI Recovery patch closes a major architectural gap. Frontend hook decomposition is the final frontier for maintainability.
