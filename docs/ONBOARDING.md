# Developer onboarding — OpsMantik

**Time-to-first-PR target:** 1–2 weeks for a small feature touching documented surfaces (tests + docs).

---

## 1. Prerequisites

- Node 20+ (match [`.github/workflows/ci.yml`](../.github/workflows/ci.yml))
- Supabase CLI (for migrations): `npm i -g supabase`
- Git access to the repo

---

## 2. Local setup

```bash
git clone <repo-url>
cd opsmantik-v1
npm ci
cp .env.local.example .env.local
```

Fill **minimum** for local API/dashboard:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; never commit |

Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_ORIGINS` for auth/CORS.

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## 3. Database

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Use a **dev** project; never run experimental migrations against production from a laptop without a runbook.

---

## 4. Tests

See [TESTING_STRATEGY.md](./TESTING_STRATEGY.md).

```bash
npm run test:unit
npm run test:release-gates:pr    # tenant + OCI kernel (no live smoke)
```

Full release gates (includes live `smoke:intent-multi-site`) need production-like Supabase secrets:

```bash
npm run test:release-gates
```

---

## 5. Deploy gate (intent)

Before production deploy:

```bash
npm run smoke:intent-multi-site
```

See [docs/OPS/DEPLOY_GATE_INTENT.md](./OPS/DEPLOY_GATE_INTENT.md) and [`.cursor/rules/deploy-gate-intent.mdc`](../.cursor/rules/deploy-gate-intent.mdc).

---

## 6. E2E / Playwright

```bash
# Requires E2E_SITE_PUBLIC_ID for get-e2e script
node scripts/get-e2e-call-event-secret.mjs
npm run e2e
```

---

## 7. Where to read next

| Topic | Doc |
|-------|-----|
| Post-deploy smoke | [runbooks/DEPLOY_POST_VERIFY.md](./runbooks/DEPLOY_POST_VERIFY.md) |
| Redis / QStash incident | [runbooks/INFRA_REDIS_QSTASH_CHECKLIST.md](./runbooks/INFRA_REDIS_QSTASH_CHECKLIST.md) |
| Module map | [architecture/MODULE_BOUNDARIES.md](./architecture/MODULE_BOUNDARIES.md) |
| OCI / value SSOT | [architecture/OCI_VALUE_ENGINES_SSOT.md](./architecture/OCI_VALUE_ENGINES_SSOT.md) |
| Security | [architecture/SECURITY.md](./architecture/SECURITY.md) |
| Observability | [architecture/OPS/OBSERVABILITY_REQUIREMENTS.md](./architecture/OPS/OBSERVABILITY_REQUIREMENTS.md) |
| ADRs | [architecture/adr/README.md](./architecture/adr/README.md) |
