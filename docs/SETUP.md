# OpsMantik - Setup & Integration Guide

## 🛠️ Local Environment Setup
1. **Clone**: `git clone <repository_url>`
2. **Install**: `npm install`
3. **Environment**: Copy `.env.example` to `.env.local` and fill in Supabase/QStash keys.
4. **Develop**: `npm run dev`

## 🌍 Vercel Deployment
Deploying to Vercel requires the following environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS` (Comma-separated list of tracked domains)
- `CRON_SECRET` (For Watchtower security)
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`

## 🔌 Website Integration (The Tracker)
To track a website, embed the following script tag just before the closing `</head>` tag:

```html
<script 
  src="https://console.opsmantik.com/ux-core.js" 
  data-ops-site-id="YOUR_SITE_PUBLIC_ID"
  async>
</script>
```

### Advanced Attributes
- `data-geo-city`: Optional city override.
- `data-ops-proxy-url`: Custom proxy endpoint for call events.

## 🔗 Google Ads OCI (Offline Conversion Import)
To enable Google Ads integration:
1. Obtain Google Ads Developer Token.
2. Setup OAuth credentials in the OpsMantik Admin Dashboard.
3. Configure the `AdService` to poll for "Qualified Leads" and upload them via the conversion import script.
