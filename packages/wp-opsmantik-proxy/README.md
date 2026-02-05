# OpsMantik First-Party Proxy (WordPress)

This plugin adds a **first-party** endpoint on the customer domain that:

1. Receives a browser call-event payload (no secret in browser)
2. **Signs** it server-side with HMAC-SHA256
3. Forwards it to `https://console.opsmantik.com/api/call-event/v2`
4. Returns the upstream JSON back to the browser

## Install

- Copy `packages/wp-opsmantik-proxy/` into your WordPress `wp-content/plugins/opsmantik-proxy/`
- Activate **OpsMantik First-Party Proxy** in WP Admin → Plugins

## Configure secret (recommended)

Add to `wp-config.php`:

```php
define('OPSMANTIK_PROXY_SECRET', 'YOUR_RANDOM_32+_CHAR_SECRET');
// Optional
define('OPSMANTIK_CONSOLE_URL', 'https://console.opsmantik.com');
```

Alternative (not recommended): WP Admin → Settings → OpsMantik Proxy, paste the secret.

## Browser endpoint

Your site endpoint becomes:

`https://YOURDOMAIN.com/wp-json/opsmantik/v1/call-event`

## OpsMantik tracker usage

Use `data-ops-proxy-url` on the tracker script tag:

```html
<script
  src="https://console.opsmantik.com/assets/core.js"
  data-site-id="YOUR_SITE_PUBLIC_ID"
  data-ops-proxy-url="https://YOURDOMAIN.com/wp-json/opsmantik/v1/call-event"
></script>
```

## Proof / How to verify

1. Activate plugin
2. Configure secret
3. From browser console (same site), run:

```js
fetch('/wp-json/opsmantik/v1/call-event', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ site_id: '<SITE_PUBLIC_ID>', fingerprint: 'fp_test', phone_number: 'tel:+905000000000' }),
}).then(r => r.json()).then(console.log);
```

Expected: JSON with `status: "matched"` and a `call_id`.

