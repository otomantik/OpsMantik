# 🎯 OPSMANTIK - Google Ads Attribution & Lead Intelligence Platform

Real-time tracking ve multi-touch attribution platformu. Google Ads kampanyalarınızın ROI'sini takip edin, lead'leri skorlayın ve canlı dashboard ile marketing ekibinizi güçlendirin.

## 🚀 Hızlı Başlangıç

### 1. Dependencies Kurulumu

```bash
npm install
```

### 2. Environment Variables

`.env.local.example` dosyasını `.env.local` olarak kopyalayın ve Supabase bilgilerinizi ekleyin:

```bash
cp .env.local.example .env.local
```

Gerekli değişkenler:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase proje URL'iniz
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `ALLOWED_ORIGINS` - CORS için izin verilen origin'ler (varsayılan: `*`)

### 3. Supabase Migration

Supabase CLI ile migration'ları uygulayın:

```bash
# Supabase CLI kurulumu (eğer yoksa)
npm i -g supabase

# Proje bağlantısı
supabase link --project-ref YOUR_PROJECT_REF

# Migration'ları uygula
supabase db push
```

### 4. Development Server

```bash
npm run dev
```

Uygulama `http://localhost:3000` adresinde çalışacak.

## 📁 Proje Yapısı

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

## Operations

- **[OCI Operations Snapshot](docs/operations/OCI_OPERATIONS_SNAPSHOT.md)** — Canlı OCI durumu, metrikler, transition status. Onboarding, incident response, debug için.

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

## 📝 Notlar

- Migration'lar otomatik olarak mevcut ay için partition oluşturur
- RLS (Row Level Security) aktif - kullanıcılar sadece kendi sitelerini görebilir
- Rate limiting: 100 req/min (sync), 50 req/min (call-event)
