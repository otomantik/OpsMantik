# 🎯 OPSMANTIK - Google Ads Attribution & Lead Intelligence Platform

Real-time tracking and multi-touch attribution platform. Track Google Ads campaign ROI, score leads, and empower your marketing team with a live dashboard.

## OCI Conversion Time (Zero Tolerance)

Google Ads conversion time is pinned to first intent creation time (no runtime override policy).

- Mandatory policy: `docs/OPS/OCI_CONVERSION_TIME_ZERO_TOLERANCE.md`
- Any drift from this contract is treated as a release blocker.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

`.env.local.example` dosyasını `.env.local` olarak kopyalayın ve Supabase bilgilerinizi ekleyin:

```bash
cp .env.local.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase proje URL'iniz
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `ALLOWED_ORIGINS` - CORS için izin verilen origin'ler (varsayılan: `*`)

### 3. Supabase Migration

Apply migrations with the Supabase CLI:

```bash
# Supabase CLI kurulumu (eğer yoksa)
npm i -g supabase

# Link project
supabase link --project-ref YOUR_PROJECT_REF

# Apply migrations
supabase db push
```

### 4. Development Server

```bash
npm run dev
```

The app will run at `http://localhost:3000`.

## 📚 Developer docs

- **[docs/ONBOARDING.md](docs/ONBOARDING.md)** — local setup, tests, deploy gate
- **[docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md)** — unit / integration / smoke
- **[docs/architecture/MODULE_BOUNDARIES.md](docs/architecture/MODULE_BOUNDARIES.md)** — where code lives

## 📁 Project Structure

```
opsmantik-v1/
├── app/
│   ├── api/
│   │   ├── sync/          # Event tracking endpoint
│   │   └── call-event/    # Phone call matching endpoint
│   ├── auth/
│   │   └── callback/      # OAuth callback handler
│   ├── dashboard/         # Main dashboard
│   ├── login/            # Auth page
│   └── layout.tsx
│
├── components/
│   └── ui/                # shadcn/ui components
│
├── lib/
│   ├── supabase/          # Supabase clients (browser, server, admin)
│   ├── rate-limit.ts      # Rate limiting utility
│   └── utils.ts           # Utility functions
│
├── public/
│   ├── assets/
│   │   └── core.js       # Tracking script (neutral path, ad-blocker friendly)
│   └── ux-core.js         # Legacy tracking script (backwards compatibility)
│
└── supabase/
    └── migrations/         # Database migrations
```

## 🔧 Özellikler

- ✅ Multi-Touch Attribution
- ✅ Browser Fingerprinting
- ✅ GCLID Persistence
- ✅ Lead Scoring (0-100)
- ✅ Real-time Event Tracking
- ✅ Phone Call Matching
- ✅ Partitioned Database (monthly)
- ✅ Row Level Security (RLS)

## Documentation

- **[Platform Overview](docs/overview/PLATFORM_OVERVIEW.md)** — Executive + technical summary. New developer onboarding, investor/partner narrative, architecture quick view.
- **[OCI Operations Snapshot](docs/operations/OCI_OPERATIONS_SNAPSHOT.md)** — Live OCI status, metrics, transition status. For incident response and debug.

## 📊 Database Schema

- **sites** - Site ownership (multi-tenant)
- **sessions** - Traffic pool (partitioned by month)
- **events** - Action log (partitioned by month)
- **calls** - Phone call records
- **user_credentials** - OAuth tokens

## 🧪 Test

Tracker script'i test etmek için:

```html
<!-- Recommended: Neutral path for ad-blocker avoidance -->
<script 
    src="https://assets.<YOUR_DOMAIN>/assets/core.js" 
    data-site-id="test_site_123"
></script>

<!-- Legacy path (backwards compatible) -->
<script 
    src="http://localhost:3000/ux-core.js" 
    data-site-id="test_site_123"
></script>
```

## 📝 Notes

- Migrations automatically create the partition for the current month
- RLS (Row Level Security) is active — users can only see their own sites
- Rate limiting: 100 req/min (sync), 50 req/min (call-event)
