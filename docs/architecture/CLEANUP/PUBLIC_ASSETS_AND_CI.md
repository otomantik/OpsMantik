# Public assets and CI strangler notes

## Tracker build

- Source: `scripts/build-tracker.mjs`
- Output: verify under `public/` (e.g. `core.js`) and cache headers in `next.config.ts`.

## CI jobs

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — lint, i18n, build.
- [`.github/workflows/release-gates.yml`](../../.github/workflows/release-gates.yml) — heavier checks.

Do not remove a workflow without mapping its scripts to another job.

## Strangler panel

- Panel routes remain reachable; default landing for operators is unified on `/dashboard` (see `lib/auth/landing-route.ts` changelog in git).
- Remove panel-specific UI only after import graphs show zero use (Phase C).
