# adsmantik-engine Worker

Cloudflare Worker used as SST bridge for OpsMantik.

## Active Tenant

- `kocotokurtarma.com` -> `93cb9966bcf349c1b4ece8ea34142ace`

Update `SITE_CONFIG` in `wrangler.jsonc` as you onboard new sites.

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

## Local Development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```
