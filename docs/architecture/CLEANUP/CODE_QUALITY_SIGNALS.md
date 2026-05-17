# Code quality signals (baseline)

## TypeScript

- `npx tsc --noEmit` — CI does not currently gate on this alone; run locally before large refactors.

## Duplication

- Optional: `npx jscpd lib app/api --min-lines 10 --reporter console` — track trend, do not block PRs until policy is set.

## Complexity

- Run ESLint with complexity rule locally if added later. **Do not** refactor OCI core hotspots purely for score; pair with tests.

## Knip (unused exports)

### Command and config

- `npm run audit:knip` — must exit **0**; config lives at repo root [`knip.json`](../../../knip.json).

### How Knip sees this repo (mental model)

- **Entry:** `app/**/{page,layout,route,default,error,loading,not-found,template}.{ts,tsx}` — App Router surfaces plus all `route.ts` API handlers. Three dashboard widget files are listed explicitly because they are loaded via `next/dynamic()` and static analysis does not always treat them as reachable.
- **Project:** `**/*.{ts,tsx}` — everything TypeScript in the tree, minus patterns in **`ignore`**.
- **Test entry:** `tests/**/*.test.ts`, `tests/*.test.ts`, and `tests/**/*.spec.ts` are explicit **entry** roots so Knip does not flag the test tree after removing the old `tests/**` / `playwright/**` / `**/*.test.ts` ignore globs.
- **Ignored subtrees:** `scripts/**`, `adsmantik-engine/**`, and other paths listed in [`knip.json`](../../../knip.json). Code under `scripts/**` is **not** traversed from app `entry`. A module referenced only from scripts (or only via `readFileSync` on a path string) can look “unused” to Knip; triage must use `rg` / the IDE across `app/`, `lib/`, and `scripts/` together. Example: `scripts/verify-oci-spine-checklist.mjs` reads `lib/oci/conversion-ssot.ts` as text for contract checks — not a static import edge for Knip.
- **Green Knip means:** “No issues under the current entry + ignore + exclude policy” — not “every line in the repo is reachable from production.”

### `exclude` and `ignoreExportsUsedInFile` (intentional blind spots)

[`knip.json`](../../../knip.json) sets:

- `exclude`: `types`, `exports`, `enumMembers`, `classMembers`, `duplicates` — reduces noise on large OCI-style surfaces; it also hides unused type-only exports, duplicate dependency hints, etc.
- `ignoreExportsUsedInFile.interface` / `.type`: true — type/interface exports used only inside the same file are not reported.

**Policy:** Treat stricter Knip as an occasional experiment (e.g. temporarily narrowing `exclude` in a branch) rather than a daily gate, unless the team opts in.

### `ignoreDependencies` and PostCSS / Tailwind

These packages stay listed so Knip does not fail on tooling it does not resolve statically:

| Package | Why ignored / notes |
|--------|---------------------|
| `tailwindcss` | Consumed via PostCSS / `@tailwindcss/postcss`; not always visible as a direct TS import. |

**Dead UI cleanup:** Unused shadcn stubs with **no** repo imports (`components/ui/tabs.tsx`, `dialog.tsx`, `separator.tsx`, `textarea.tsx`) were removed; `@radix-ui/react-tabs` was removed from `package.json` with them. `@radix-ui/react-dialog` remains (used by `components/ui/sheet.tsx` → live dashboard paths).

**Dependency audit:** `@upstash/ratelimit`, `googleapis`, `open`, and `server-destroy` had no TypeScript import usage in app/lib/components/tests and were **removed** from `package.json`. Re-add only when a feature needs them.

[`ignoreIssues`](../../../knip.json) for `postcss.config.mjs` marks `unlisted` as accepted for that config file.

### Per-path ignore and triage

- **`lib/domain/mizan-mantik/**`:** Intentional **legacy / strangler** tree. See [MIZAN_MANTIK_LEGACY.md](./MIZAN_MANTIK_LEGACY.md). Kept under Knip `ignore` until product sign-off to delete or migrate.
- **Single-file `ignore` rows** under `lib/oci`, `components/dashboard`, `lib/hooks`, etc.: Dropping the whole list in one change makes Knip report on the order of **~44** “unused files” (not reached from `entry`); many are still product or future-dashboard code. Remove an `ignore` line only with a wiring or deletion PR (`rg` + tests). A dry run (2026-05) that removed all per-file ignores was reverted after that Knip result.

### Optional tightening

- Remove `ignore` lines when files are deleted or when imports are wired so Knip reaches them without extra noise.
- Optional: `npx knip --reporter markdown` for a shareable report (Knip version pinned in `package.json`).
- **CI:** `.github/workflows/ci.yml` runs `npm run audit:knip` after i18n checks and before `npm run build`.
