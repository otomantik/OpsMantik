## OpsMantik V2 Call-Event Proxy (WordPress)

### Goal
Stop shipping secrets to browsers. Browsers send call-event payloads to **your own domain**; WordPress signs and forwards to OpsMantik Console.

### What you install
`packages/wp-opsmantik-proxy/` WordPress plugin.

### Endpoint created
`POST /wp-json/opsmantik/v1/call-event`

### Required config
- **Per-site secret** (same secret you provision in OpsMantik `private.site_secrets`)

Recommended: set in `wp-config.php`:

```php
define('OPSMANTIK_PROXY_SECRET', 'YOUR_RANDOM_32+_CHAR_SECRET');
define('OPSMANTIK_CONSOLE_URL', 'https://console.opsmantik.com'); // optional
```

### Tracker embed (preferred, V2)

```html
<script
  src="https://console.opsmantik.com/assets/core.js"
  data-site-id="YOUR_SITE_PUBLIC_ID_32HEX"
  data-ops-proxy-url="https://YOURDOMAIN.com/wp-json/opsmantik/v1/call-event"
></script>
```

### Backward compatibility
- If `data-ops-proxy-url` is not set, the tracker can still use V1 (`data-ops-secret`) until V1 sunset.

### Proof / How to verify
- From your site (same-origin), run:

```js
fetch('/wp-json/opsmantik/v1/call-event', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    site_id: 'YOUR_SITE_PUBLIC_ID_32HEX',
    fingerprint: 'fp_test',
    phone_number: 'tel:+905000000000'
  })
}).then(r => r.json()).then(console.log);
```

Expected response:
- HTTP 200
- JSON contains `status: "matched"` and `call_id`

