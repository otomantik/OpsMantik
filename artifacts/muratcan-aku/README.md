# Muratcan AKU SST/Cloudflare Bootstrap

Site: Muratcan Akü (28cf0aefaa074f5bb29e818a9d53b488)
Domain: muratcanaku.com
Worker URL: https://www.muratcanaku.com

## 1) Cloudflare Worker vars/secrets

- wrangler vars: use `wrangler-vars.json`
- secret payload file: `ops-call-event-secrets.json`

Set secret:
```bash
wrangler secret put OPS_CALL_EVENT_SECRETS < "artifacts\muratcan-aku\ops-call-event-secrets.json"
```

Optional tenant map token:
```bash
wrangler secret put WORKER_TENANT_MAP_TOKEN
```

## 2) Deploy adsmantik-engine
```bash
npm --prefix adsmantik-engine run deploy
```

## 3) External integration artifacts

- Tracker file to share: `artifacts\muratcan-aku\core.js`
- Embed snippet: `artifacts\muratcan-aku\embed-snippet.html`
