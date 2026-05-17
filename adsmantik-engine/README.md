# adsmantik-engine Worker

Cloudflare Worker used as SST bridge for OpsMantik.

**Slimdown context:** keep this package isolated from the Next app; operator script tiers live in [`docs/architecture/CLEANUP/MINIMUM_OPERATION_SCRIPTS.md`](../docs/architecture/CLEANUP/MINIMUM_OPERATION_SCRIPTS.md).

## Tenant map (`SITE_CONFIG`)

Wrangler `vars.SITE_CONFIG` lists **hostname (no `www.`) → OpsMantik `public_id`**. It is the **bundle-of-record** for those hosts: entries from `SITE_CONFIG_URL` **never override** the same host, so a bad remote row cannot replace a known-good static id (avoids ghost UUIDs → `SITE_NOT_FOUND` on `/api/sync`).

SST bundle only (same five storefronts as `SITE_CONFIG`). *Tecrübeli Bakıcı* is not on this SST path — use console signed embed (`data-api` → `console…/api/sync`) for that site.

| Host (normalized) | `public_id` | Wrangler `routes` (this account) |
| --- | --- | --- |
| `kocotokurtarma.com` | `93cb9966bcf349c1b4ece8ea34142ace` | yes |
| `kirklareli-luleburgaz-servisi.com` | `2e695ecf1c49453590882ca9bd655fb7` | no — zone not in this CF account; use `*.workers.dev` + `Origin` or attach Worker in that zone |
| `muratcanaku.com` | `178c4e31306e436b8be67d5f6134b118` | yes |
| `spotbizdelastik.com` | `00699ff719394611b224a05ffab0675d` | yes |
| `umutotocekici.com` | `b54e2f0e3ca44fd1a614d8d99bfa6902` | yes |
| `gecgenotokurtarici.com` | `862314ce888d44b29aa222833e9b0af2` | yes |

`SITE_CONFIG_URL` still fills **hosts not listed** in `SITE_CONFIG`. New sites: add a row to wrangler (or rely on remote-only host until the next deploy).

## Routes (Worker paths)

Same script handles every customer:

- `POST /opsmantik/sync` → forwards to `https://console.opsmantik.com/api/sync`
- `POST /opsmantik/call-event` → signs and forwards to `https://console.opsmantik.com/api/call-event/v2`
- `POST /metrics/track` → legacy compatibility, mapped to `/api/sync`

### How tenant resolution works

1. **Custom domain on Cloudflare** — Request hits `https://{customer.com}/opsmantik/sync` (Worker route on that zone). Hostname is normalized (`www.` stripped) and looked up in `SITE_CONFIG`.

2. **Single `*.workers.dev` URL for everyone** — Embed uses `data-api="https://YOUR_WORKER.workers.dev/opsmantik/sync"` (see `scripts/deploy-muratcan-aku-sst.mjs`). The Worker hostname is **not** in `SITE_CONFIG`; resolution uses the browser **`Origin`** (then **`Referer`**) hostname, normalized the same way. Keep `SITE_CONFIG` keys aligned with real storefront hosts (apex, no `www.`).

### Multi-zone Cloudflare

`wrangler.jsonc` `routes` attach this Worker to `*/opsmantik/*` on each SST apex zone in the same Wrangler account. If `wrangler deploy` errors on a missing zone, that domain is not in this CF account — attach the Worker in that zone’s dashboard or use a `*.workers.dev` base URL in the embed (`Origin` resolution).

## Secrets

Set call-event secret map (JSON) once per environment:

```bash
wrangler secret put OPS_CALL_EVENT_SECRETS
```

Example value:

```json
{"93cb9966bcf349c1b4ece8ea34142ace":"REPLACE_WITH_REAL_SECRET"}
```

Set tenant-map API token once per environment:

```bash
wrangler secret put WORKER_TENANT_MAP_TOKEN
```

The same token must be set in app runtime as `WORKER_TENANT_MAP_TOKEN`.

## Local Development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Muratcan AKU SST Bootstrap

From repo root, generate Cloudflare/SST-ready artifacts (site map, secret map, embed, core.js copy):

```bash
npm run muratcan:sst -- --site-public-id <SITE_PUBLIC_ID> --domain <DOMAIN> --worker-url <https://your-worker.workers.dev>
```

Output folder: `artifacts/muratcan-aku`
