# Minimum operation scripts (periphery)

Tier **1** — needed for OCI deploy / incident response:

- `npm run test:release-gates` / `test:release-gates:pr`
- `npm run smoke:oci-rollout-readiness:strict`
- `npm run worker:google-ads-oci` (or hosted cron equivalent)
- `npm run tracker:build` / `tracker:embed`

Tier **2** — billing / ops when features enabled:

- `smoke:sprint1`, `smoke:watchtower` (as needed)

Tier **3** — developer / one-off DB helpers under `scripts/db/` — keep but do not import into app runtime.

**adsmantik-engine:** separate Wrangler project; see `adsmantik-engine/README.md`. Keep workspace isolation; no import from `app/`.
