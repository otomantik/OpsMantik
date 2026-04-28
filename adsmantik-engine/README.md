# adsmantik-engine Worker

Cloudflare Worker used as SST bridge for OpsMantik.

## Active Tenant

- `kocotokurtarma.com` -> `93cb9966bcf349c1b4ece8ea34142ace`

Primary source is now `SITE_CONFIG_URL` (runtime map pulled from OpsMantik API).
`SITE_CONFIG` remains emergency fallback only.

## Routes

- `POST /opsmantik/sync` -> forwards to `https://console.opsmantik.com/api/sync`
- `POST /opsmantik/call-event` -> signs and forwards to `https://console.opsmantik.com/api/call-event/v2`
- `POST /metrics/track` -> legacy compatibility route, mapped to `/api/sync`

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
