# Location & District (İlçe) – How It Works and How to Improve

## Current sources (priority order)

1. **Client meta** – `meta.city` / `meta.district` in the sync payload (e.g. from tracker data attributes).
2. **Cloudflare** – `cf-ipcity`, `cf-ipdistrict`, `cf-ipcountry` (visitor IP; we prefer these over Vercel so the edge location is not used).
3. **Vercel** – `x-vercel-ip-city`, `x-vercel-ip-country` (no district).
4. **Generic headers** – `x-city`, `x-district`, `x-country` (if set by your proxy/CDN).
5. **Fallback** – city `"Unknown"`, district `null`.

So **ilçe (district)** comes from, in order: **meta** → **Cloudflare** (`cf-ipdistrict`) → **generic** (`x-district`).  
Vercel does not provide district.

---

## How to get better district data

### 1. Rely on Cloudflare (already in place)

- Domain is proxied through Cloudflare (orange cloud) so `cf-ipcity` / `cf-ipdistrict` are set from the **visitor IP**.
- We prefer Cloudflare over Vercel for city/country so you don’t see edge locations (e.g. Amsterdam) instead of the real city.
- If `cf-ipdistrict` is empty for some IPs, that’s a Cloudflare Geo IP limitation for that region/plan; you can’t fix it from code alone.

### 2. Optional: script tag data attributes (implemented)

If the **site** already knows the user’s city or district (e.g. from a form, checkout, or your own geo), you can pass it to the tracker so it’s sent in every event:

```html
<script
  defer
  src="https://assets.opsmantik.com/assets/core.js"
  data-site-id="YOUR_SITE_ID"
  data-api="https://console.opsmantik.com/api/sync"
  data-geo-city="Istanbul"
  data-geo-district="Kadıköy"
></script>
```

- **`data-geo-city`** – Overrides/sets city (backend uses `meta.city` first).
- **`data-geo-district`** – Sets district (backend uses `meta.district` first).

Use this when the value is the same for all users on that page (e.g. a branch/landing page). For per-user location you’d set these from your CMS/backend when rendering the script tag.

### 3. Optional (future): browser geolocation + reverse geocode

- Ask for browser location (with user consent), get lat/lon, then call a reverse-geocode API to get city + district (ilçe).
- Send result as `meta.city` and `meta.district` in the sync payload; backend already uses `meta` first.
- Trade-offs: permission, latency, API cost. Can be opt-in per site or behind a feature flag.

---

## Summary

| Source              | City | District | Notes                                      |
|---------------------|------|----------|--------------------------------------------|
| `meta` (data-geo-*) | ✅   | ✅       | Optional; set on script tag or from backend |
| Cloudflare          | ✅   | ✅*      | *When `cf-ipdistrict` is available         |
| Vercel              | ✅   | ❌       | No district                                |
| Generic headers     | ✅   | ✅       | If your infra sets x-city / x-district     |

For the best ilçe coverage: keep Cloudflare proxied, and where you know the location (e.g. branch page), add **`data-geo-city`** and **`data-geo-district`** on the tracker script.
