# `scripts/db/_archive` — HC-U2 site-maintenance hygiene

## `site-specific/` (active archive)

One-off and **site/client-named** DB helpers (`oci-muratcan-*`, `oci-eslamed-*`, Koç, joint Eslamed+Muratcan dökümleri, vb.) live here so `scripts/db/` root stays generic (`oci-enqueue.mjs`, `oci-2240-rontgen-saldiri-ayikla.mjs`, `pr9h6-*.mjs`, …). **Mirror:** site-specific forensic SQL runbooks live under `docs/runbooks/_archive/site-specific/`.

**Run from repo root** (paths in docs and `package.json` use repo-relative form):

```bash
node scripts/db/_archive/site-specific/<script>.mjs
```

**Path rules inside archived files**

- Repo root (`.env.local`, spawn `cwd`): `join(__dirname, '..', '..', '..', '..')` from `site-specific/`.
- `scripts/db/lib/*`: import from `../../lib/...` (two levels up to `scripts/db/`, then `lib/`).
- Delegates to siblings still in `scripts/db/`: e.g. `join(__dirname, '..', '..', 'pr9h6-backfill-intents-to-oci-queue.mjs')` or `join(__dirname, '..', '..', 'oci-2240-rontgen-saldiri-ayikla.mjs')` (two `..` reach `scripts/db/`).

**Policy**

- Do not move files without updating `package.json`, docs, and tests in the same change.
- Prefer generic CLIs + site argument over new site-prefixed filenames.
- Never archive `supabase/migrations/`.

**Removed (artifact, not SSOT)**

- `scripts/db/muratcan-donusum-rapor.json` — generated JSON report (HC-U2, 2026-05).

See: `scripts/google-ads-oci/HC-U2-next-inventory.md`.
