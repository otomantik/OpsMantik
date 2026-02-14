# Revenue Kernel — Durum Raporu (Ne Yaptık)

**Tarih:** 2026-02  
**Kapsam:** Billing/Revenue Kernel release, testler, runbook, PR ayrımı.

---

## 1. Yapılan İşler (Özet)

| Konu | Ne yapıldı | Nerede |
|------|------------|--------|
| **Backfill endpoint** | POST `/api/cron/reconcile-usage/backfill`, cron auth, body `from`/`to` (≤12 ay), UPSERT DO NOTHING, `{ enqueued, months, sites }` | `app/api/cron/reconcile-usage/backfill/`, unit test, evidence doc |
| **PR-9 scaling** | `ingest_idempotency` için RANGE(created_at) partition migration + BRIN fallback migration, maintenance fonksiyonu, EXPLAIN + rollback doc | `supabase/migrations/20260217*`, `docs/BILLING/PR9_IDEMPOTENCY_SCALING.md` |
| **PR-10 financial gate testleri** | createSyncHandler’a optional deps (tryInsert, validateSite, getQuotaDecision, publish, fallback, redis…). 4 senaryo: duplicate, db down, quota reject, fallback | `app/api/sync/route.ts` deps, `tests/unit/sync-financial-gate.test.ts` |
| **Release branch** | Sadece PR-1..PR-4 + fail-secure + runbook (+ billing-metrics build fix) | `release/revenue-kernel-pr1-4` |
| **Runbook** | Cron auth (CRON_FORBIDDEN), release prosedürü, merge sonrası smoke, PR #17 ayrımı (merge block), reconciliation kanıt sorgusu | `docs/OPS/REVENUE_KERNEL_RELEASE_RUNBOOK.md` |
| **PR #17 ayrımı** | “Release vs future pack” dokümante; release PR açma adımları; db push ne zaman gerekli | `docs/OPS/PR17-RELEASE-STEPS.md`, runbook §4.2 |

---

## 2. Şu Anki Durum

- **Mevcut branch:** `release/revenue-kernel-pr1-4` (local = origin ile aynı, 1 değişiklik: runbook’ta küçük ekleme).
- **Release branch son commit’ler:**
  - `dc79e71` — fix(build): lib/billing-metrics (sync, run, watchtower import’ları için)
  - `ea3f7f3` — PR-1..PR-4 + fail-secure + reconciliation + runbook
  - `d192b02` — PR-1..PR-4 + fail-secure + runbook (ilk paket)
  - `75e6751` — (master’daki prod HEAD) PR-1..PR-4 + recover cron

- **Master’a göre:** Release branch, master’dan 3 commit ileride (d192b02, ea3f7f3, dc79e71). Bu branch merge edilince prod’a sadece bu paket gider.

- **PR #17:** `chore/revenue-kernel-future-pack` → master karışık paket (release + future pack + PR9 migration’lar). **Merge edilmemeli.** Runbook’ta merge block yorumu ve ayrım planı yazılı.

---

## 3. Sıradaki Adımlar (Senin Yapacakların)

1. **PR #17’yi kapat** (merge etmeden) — GitHub’da Close pull request.
2. **Release PR aç ve merge et:** base `master`, compare `release/revenue-kernel-pr1-4`.  
   Link: `https://github.com/otomantik/OpsMantik/compare/master...release/revenue-kernel-pr1-4`
3. **Db push:** Bu release merge için **gerek yok** (20260216* zaten prod’da). Future pack merge ederken 20260217* migration’ları uygulanacak.
4. Merge sonrası prod smoke: runbook §4.1’deki watchtower + reconcile-usage/run curl’leri.

---

## 4. Dosya Referansları

| Amaç | Dosya |
|------|--------|
| Release adımları + db push cevabı | `docs/OPS/PR17-RELEASE-STEPS.md` |
| Cron auth, release prosedürü, PR #17 ayrımı | `docs/OPS/REVENUE_KERNEL_RELEASE_RUNBOOK.md` (§4.1, §4.2, §4.5) |
| PR-9 migration + rollback | `docs/BILLING/PR9_IDEMPOTENCY_SCALING.md` |
| Backfill + evidence | `docs/BILLING/REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE.md` |

---

**Tek cümle:** Release paketi `release/revenue-kernel-pr1-4`’te kilitlendi; build düzeltmesi (billing-metrics) eklendi. PR #17 merge edilmeyecek; release’i ayrı PR’dan (release → master) merge et, db push bu release için yok.
