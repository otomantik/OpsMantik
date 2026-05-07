---
status: active
contract_id: closed_system_score_v1
last_review: 2026-05-07
ssot_100_choice: A
---

# Closed System Score Contract (OpsMantik)

This document removes ambiguity around the word **“100”** and related scores in the **closed** conversion pipeline (intent → match → hash/audit lanes + `offline_conversion_queue` journal → Google offline conversions).

## SSOT seçimi — “100” kelimesi (A veya B, tek yürürlük)

**Bu kurulumda seçim: [A] — ekonomi SSOT.** (`ssot_100_choice: A` üst bilgide.)

| ID | Anlam | Bu org’da |
|----|--------|-----------|
| **A** | **Ekonomi skalası** — “100” reklam/ürün dilinde = `OPTIMIZATION_STAGE_BASES.won` **100 major** → `toExpectedValueCents` = **10000** minor (TRY 2 decimals; ciro override ayrı politika). | **Seçili (yürürlükte).** |
| **B** | **Operatör kalite skalası** — UI **25 \| 60 \| 100** = `CATEGORICAL_SCORES` / `lead_score`; kuruşa giren tek kanun ayrı PR ile tanımlanır. | **Yürürlükte değil** (A seçiliyken kuruş yalnızca aşama tabanı + onaylı politika; B ayrı promot edilene kadar FORBIDDEN). |

**Tek cümle (bu org):** Ürün ve Google offline tarafında **“100” = kazanılan aşamanın ekonomik tabanı (100 major)**; paneldeki **25/60/100 = kalite kategorisi** aynı rakamları paylaşır ama **won ekonomik 100 ile özdeş değildir** ve tek başına kuruş üretmez.

## Binary geçitler (release / işlem — evet-hayır)

| ID | Kontrol | PASS | FAIL |
|----|---------|------|------|
| **G1** | Click | En az biri dolu: `gclid` \| `wbraid` \| `gbraid` | Hiçbiri yok → Google upload için queue satırı `BLOCKED_PRECEDING_SIGNALS` + `MISSING_CLICK_ID` veya structured skip reason |
| **G2** | Rıza | `hasMarketingConsentForCall` true (seal/satış yollarında) | false → queue write yok; structured reason `CONSENT_MISSING` (silent skip yasak) |
| **G3** | Zaman SSOT | [`oci_time_ssot_health.sql`](../../scripts/sql/oci_time_ssot_health.sql) ve operasyonel süreç **GREEN** | **RED** → şema/veri düzeltmeden release yok |
| **G4** | Hash | `marketing_signals` hash zinciri tutarlı | Kırık zincir → **STOP** + incident; deploy yok |
| **G5** | Idempotency | Aynı `call_id` + aynı dönüşüm için çifte kuruş yok | 23505 dışı çelişki / tutarsız `value_cents` → **BUG** |

Deploy öncesi zorunlu paket: `npm run test:release-gates` (workspace kuralı). G3/G4 **FAIL** iken production deploy **yasak** (operasyonel STOP).

## Three non-interchangeable concepts

| Term | Code / storage name | Meaning |
|------|---------------------|---------|
| **Lead quality score** | `lead_score` (and UI picks **25 \| 60 \| 100**) | Operator or automation **quality / warmth** on the lead. Stored on `calls` and used for routing, UX, and (separately) categorical training constants `CATEGORICAL_SCORES` in [`lib/oci/optimization-contract.ts`](../../lib/oci/optimization-contract.ts). **Not** the same as economic “100 major units” for won. |
| **Stage economic base (major units)** | `stage_base_major` / `OPTIMIZATION_STAGE_BASES` | Canonical **conversion economics** per pipeline stage (`junk` / `contacted` / `offered` / `won`). The **won** row uses base **100** major units before policy/currency cent conversion — this is **not** “operator clicked 100”. See same module. |
| **Truth closure score** | `truth_closure_score` (concept; not a DB column) | **Audit / health / release** notion: the conversion chain is fully closed and green (e.g. time SSOT health, ledger consistency, export gates). **Must never** be written as Google Ads conversion value. |
| **Queue health score** | `queue_health_score` / [queue-health-contract.ts](../../lib/oci/queue-health-contract.ts) | **Operational** reliability of the export queue (stuck, DLQ, won pipeline leak, rates). **Not** `lead_score`, **not** stage economics, **not** Google value — see [OCI_QUEUE_HEALTH.md](./OCI_QUEUE_HEALTH.md). |

## Google Ads value (production)

- **Production Google conversion value** (minor units / majors per policy) is determined by **canonical stage economics** and **approved value policy** (`value_policy_version`, `value_source`, [`CONVERSION_VALUE_POLICY_VERSION`](../../lib/oci/marketing-signal-value-ssot.ts)).
- **`lead_score` is not**, today, a **direct production multiplier** on Google value in [`resolveOptimizationValue`](../../lib/oci/optimization-contract.ts) (`systemScore` is held at `0` for optimization value — intentional).

## Storage field glossary

| Field | Role |
|-------|------|
| `conversion_value` / `optimization_value` | Major-unit style snapshot fields on rows; derived from stage economics + policy, not from `truth_closure_score`. |
| `expected_value_cents` / `value_cents` | **Minor units** sent or compared for export; provenance via `value_source`. |
| `value_source` | Why this cent value was chosen (e.g. `stage_model`, `won_stage_model_fallback`). |
| `policy_version` | Which value policy revision applied (e.g. `oci_conversion_value_policy_v1`). |

## Manual vs automatic (same contract)

- **Manual score**: Operator selects **25 / 60 / 100** in the Hunter overlay → stored as `lead_score` (quality).
- **Automatic score**: Any automation must **write the same field** (`lead_score`) with the **same 0–100 semantics**; no parallel “shadow 100”.

### Faz 3 — Manuel = otomatik (tek yüzey)

- **Tek depo alanı:** Kalite puanı yalnızca `lead_score` (UI ve otomasyon aynı semantik).
- **Paralel “gizli 100” yok:** Aynı çağrı için ayrı bir kalite skoru sütunu + farklı kuruş kuralı **yasak** (SSOT tek boru).

## Explicit non-goals (production today)

- **`truth_closure_score`** is **never** Google conversion value.
- **No** silent use of `lead_score` as a **production Google value multiplier** without a **separate promoted PR** that includes: replay tests, calibration, health SQL updates, migration/docs/tests, and a rollback plan.

## FORBIDDEN equivalences

- Do **not** say “lead_score 100” and “won economic 100” are the same thing.
- Do **not** use health/audit “all green” scores as **offline conversion payload value**.
- **A seçiliyken:** UI kalite puanı (`lead_score`) **tek başına** Google kuruşunu değiştirmez; çarpan yoksa ara “yarı çarpan” da yok (`LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED === false`).
- **Aynı anda** iki farklı `expected_value_cents` formülünü üretimde paralel yürütmek **yasak** (tek SSOT: `buildOptimizationSnapshot` → `resolveMarketingSignalEconomics` / ilgili seal yolu).
- **Stage tabanları** (`OPTIMIZATION_STAGE_BASES`) ML veya shadow skorla **runtime’da değiştirilmez**; değişiklik yalnızca sözleşmeli migration + PR.

## Related documents

- [`OCI_VALUE_ENGINES_SSOT.md`](./OCI_VALUE_ENGINES_SSOT.md) — export engines
- [`EXPORT_CONTRACT.md`](./EXPORT_CONTRACT.md) — write authority
- Time SSOT health: [`scripts/sql/oci_time_ssot_health.sql`](../../scripts/sql/oci_time_ssot_health.sql)
