# HC-U2 — Next PR inventory (site-specific DB / runbook hygiene)

Generated for **Hard Cleanup phase U2**: archive, delete, or relocate **site/client-named** maintenance under `scripts/db/*` and `docs/runbooks/oci*.sql`.

**Status (repo pass):** bulk archive + path/test/doc updates below are **done**. `npm run test:release-gates` **passed** on this tree (tenant boundary, OCI kernel, runtime budget, chaos core, strict rollout smoke).

### Executed (HC-U3 — quarantined Apps Script forks hard-delete + fixtures)

- **`tests/fixtures/google-ads-oci/PR9H7B_GOOGLE_ADS_SCRIPT_PRODUCTION_SNAPSHOT.js`** — frozen copy of ex-`GoogleAdsScriptProduction.js` for PR-9H.7B / GCLID-first string parity tests.
- **`tests/fixtures/google-ads-oci/PR9H4C_MURATCAN_MARK_DEFAULT_SNAPSHOT.js`** — frozen `var doMark = markAsExported !== false` line (ex-Muratcan fork).
- **`scripts/google-ads-oci/_archive/quarantine-forks/*.js`** — **removed** from repo (`git rm`); canonical paste remains **`scripts/google-ads-oci/GoogleAdsScriptUniversal.js`**.
- **`fleet-quarantine.json` v2** — `file` paths are **repo-relative** (`tests/fixtures/...`); schema + disk existence enforced in `oci-script-fleet-truth-contract.test.ts`.
- **CI / docs** — production + PR-9H.4C/7D tests read fixtures or Universal; runbooks / EXPORT_CLOSURE / OPS audit updated.

### Executed (HC-U2 — `scripts/db` bulk archive)

- **`scripts/db/_archive/site-specific/`** — `git mv` of Muratcan / Eslamed / Koç / joint ad-hoc helpers (27 files). Imports to `scripts/db/lib/*` rewritten to `../../lib/...`; repo root `.env.local` and spawn `cwd` use four `..` segments from `site-specific/`. `koc-queue-funnel-coexistence-resync.mjs` delegates to `scripts/db/pr9h6-backfill-intents-to-oci-queue.mjs` via `../../pr9h6-...` from `site-specific/`.
- **`package.json`** — `db:oci-dump`, `db:oci-aktivite`, `db:oci-2240-dokum` point at `_archive/site-specific/...`.
- **Docs** — `OCI_GOOGLE_ADS_SCRIPT_CONTROL.md`, `OCI_GCLID_CAPTURE_FLOW.md`, `DEAD_CODE_AUDIT.md`, `.cursor/plans/oci_audit_remediation_deep.plan.md` path updates.
- **Tests** — `conversion-math-ssot-lock.test.ts`, `koc-queue-funnel-coexistence-resync-contract.test.ts` updated to archived paths.
- **Removed** — `scripts/db/muratcan-donusum-rapor.json` (generated artifact).

### Executed (HC-U2 — `docs/runbooks` site-specific SQL)

- **`docs/runbooks/_archive/site-specific/*.sql`** — `git mv` of Eslamed / Muratcan / joint forensic SQL (16 files). **Kept in** `docs/runbooks/`: `oci_production_queue_check_and_insert.sql`, `oci_seal_queue_dunden_beri.sql` (generic).
- **`tests/unit/oci-runbook-pr-c-banner.test.ts`** — PR-C scans both `docs/runbooks/` and `_archive/site-specific/` for `oci*.sql`.
- **Cross-links** — `OCI_QUEUE_REPAIR_INDEX.md`, `scripts/db/oci-daily.mjs`, archived `eslamed-intent-event-deep-analiz.mjs`, `oci-muratcan-donusum-analiz.mjs`.

## Classification legend

| Tag | Meaning |
|-----|---------|
| **archive** | Move under `scripts/db/_archive/` (or similar) with README pointer; keep git history |
| **delete-candidate** | No CI reference; superseded by Universal + platform RPCs; remove after owner sign-off |
| **manual-review** | May still be run ad hoc; rename to neutral slug or add “historical” banner |

## `scripts/db/*` — filename hits (koc / muratcan / eslamed / tecrubeli / bakici / rapor / dokum / diagnostic / canary)

| Path | Tag | Notes |
|------|-----|-------|
| `oci-muratcan-*.mjs` (many) | **archived** | → `scripts/db/_archive/site-specific/` |
| `oci-eslamed-*.mjs` | **archived** | → `_archive/site-specific/` (generic `oci-2240-rontgen-saldiri-ayikla.mjs` stays in `scripts/db/`) |
| `oci-bugun-donusum-dokum-eslamed-muratcan.mjs` | **archived** | Joint döküm |
| `oci-2240-rontgen-saldiri-ayikla.mjs` | manual-review | **Stays** in `scripts/db/` (multi-site; `npm run db:oci-2240-rontgen`) |
| `koc-queue-funnel-coexistence-resync.mjs` | **archived** | Koç-specific |
| `koc-pending-exportable-phone-report.ts` | **archived** | Koç-specific |
| `kocoto-gclid-report.mjs` | **archived** | Koç Oto naming |
| `oci-queue-status-for-site.ts` | manual-review | Generic CLI; doc mentions Tecrubeli |
| `oci-cleanup-junk-and-backfill-intent-contacted.ts` | manual-review | Referenced from `package.json` (`db:oci-intent-contacted:tecrubeli:*`) |
| `oci-canary-live-export.mjs`, `pr9h7g-fresh-hashed-phone-canary.mjs`, `recover-canary-processing-row.mjs` | manual-review | Canary / evidence tooling — keep until canary program ends |
| `oci-diagnostic-sessions.mjs` | manual-review | Generic diagnostic |
| `eslamed-intent-event-deep-analiz.mjs` | **archived** | → `_archive/site-specific/` |
| `muratcan-donusum-rapor.json` | **removed** | One-off JSON report; deleted HC-U2 |

## `docs/runbooks/oci*.sql`

| Path | Tag | Notes |
|------|-----|-------|
| `oci_eslamed_*.sql` | **archived** | → `docs/runbooks/_archive/site-specific/` |
| `oci_muratcan_*.sql` | **archived** | → `_archive/site-specific/` |
| `oci_bugun_deger_ozet_eslamed_muratcan.sql` | **archived** | Joint |
| `oci_eslamed_muratcan_bugun_intent_durum.sql` | **archived** | Joint |
| `oci_production_queue_check_and_insert.sql` | manual-review | Generic — **stays** in `docs/runbooks/` |
| `oci_seal_queue_dunden_beri.sql` | manual-review | Generic seal helper — **stays** in `docs/runbooks/` |

## `package.json` references

Scripts that embed **site slugs** in npm names (Tecrubeli, Eslamed in `db:enqueue:*`, `db:oci-2240-rontgen*`, Tecrubeli-only rows, etc.): **optional follow-up** — could add neutral aliases (`db:oci-queue-status -- <slug>`) without removing old names; **not** required for HC-U2 closure. `db:oci-dump` / `db:oci-aktivite` / `db:oci-2240-dokum` already point at `_archive/site-specific/`.

## Tests impacted by HC-U2

HC-U1 moved fleet tests to **Universal**; HC-U2 should **not** reintroduce per-site script path assertions. DB script moves may require updating **grep-based** tests only if paths are hard-coded (grep before delete).

## Recommendation

- **HC-U2:** **closed** for the archive relocations above; optional later: slug-neutral `package.json` aliases only if operators want fewer site-prefixed script names.
- **HC-U3 (Apps Script forks):** **closed** for in-tree deletion — frozen literals live under `tests/fixtures/google-ads-oci/` + `fleet-quarantine.json` v2; Universal is the only runnable fleet source in `scripts/google-ads-oci/`.
