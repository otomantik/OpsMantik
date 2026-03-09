# I18N Evidence (Consolidated)

This document consolidates the i18n audit and proof evidence previously spread across multiple I18N_* reports. All active documentation is in English; runtime UI strings remain in i18n locale files.

---

## 1. Summary and scope

- **Dictionary audit:** Base locale `en` with 496 keys; locales `tr`, `it` in sync (no missing keys).
- **Dashboard and shared UI:** Inventory and proof phases (3.1–3.4) verified hardcoded strings and shared UI components.
- **Critical issues:** Addressed via I18N_CRITICAL_REPORT, I18N_LEAK_REPORT, I18N_ISSUES_AUDIT.
- **Comb scans:** I18N_COMB_SCAN_4/5 for coverage and gap analysis.

---

## 2. Dashboard inventory

Dashboard screens and components were audited for hardcoded Turkish or non-i18n text. Proof and inventory phases (3.1–3.4) confirmed:

- Hardcoded inventory phases (3.1, 3.2) documented remaining strings.
- Dashboard proof (Phase 3.3) validated dictionary sync and zero violations where applied.
- Shared UI inventory (Phase 3.4) covered cross-cutting components.

---

## 3. Critical issues and leaks

Critical reports and leak audits identified:

- Missing or inconsistent keys across locales.
- Leak report: strings exposed without i18n.
- Issues audit: prioritization and remediation status.

These have been tracked and resolved per sprint; any open items belong in the active sprint backlog.

---

## 4. Comb scans

Comb scans (4 and 5) provided:

- Coverage analysis across codebase and docs.
- Gap reports for global SaaS readiness.

Results are superseded by the current state: docs are English-only; app UI uses i18n dictionaries.

---

## 5. Shared UI

Shared UI inventory (Phase 3.4) listed components and pages that must use i18n. Compliance is enforced via code review and the proof scripts.

---

**Reference:** For generating fresh proof output, use `scripts/generate-i18n-proof.mjs` with default path `docs/evidence/I18N_EVIDENCE.md` (or as configured).
