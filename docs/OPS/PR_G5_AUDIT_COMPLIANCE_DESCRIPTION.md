# PR: feat(G5) – Audit log table + write path for billing/admin

## Summary
- **Branch:** `feature/G5-audit-compliance`
- **Target:** `master`
- Tier-1 roadmap: "audit log table and write path for billing/admin".

## Changes
- **Migration:** `20260219100000_audit_log_g5.sql` – `public.audit_log` table (append-only; RLS: service_role only).
- **Lib:** `lib/audit/audit-log.ts` – `appendAuditLog(client, params)` (non-throwing).
- **Wired:** `invoice_freeze` (cron), `dispute_export` (user) – see `docs/OPS/AUDIT_LOG_G5.md`.
- **Tests:** `tests/unit/audit-log.test.ts` (3 tests).

## How to open this PR on GitHub
1. Go to: https://github.com/otomantik/OpsMantik/compare/master...feature/G5-audit-compliance
2. Click "Create pull request" and use the title/description above.
