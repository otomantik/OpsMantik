# OpsMantik — Unit Test Planı

**Tarih:** 8 Şubat 2026  
**Amaç:** Kritik fonksiyonların kodla test edilmesi; Test kategorisi puanının (70→80+) yükselmesi.

---

## 1. Mevcut Durum

| Dosya | Kapsam |
|-------|--------|
| `tests/unit/rateLimitService.test.ts` | RateLimitService (fail-open/fail-closed, per-site key) |
| `tests/unit/replayCacheService.test.ts` | ReplayCacheService (replay key, TTL) |
| `tests/unit/siteIdentifier.test.ts` | isValidSiteIdentifier (UUID, 32-hex, reject) |
| `tests/unit/verifySignedRequest.test.ts` | İmza doğrulama yardımcıları |

**Çalıştırma:** Node.js yerleşik test runner kullanılıyor. Örnek:

```bash
node --import tsx --test tests/unit/*.test.ts
```

**Eksik:** Call-event Zod şeması, CORS helpers, cron auth mantığı, attribution/source classifier gibi kritik parçalar için test yok.

---

## 2. Öncelik Sırasıyla Hedef Testler

### Faz 1 — Güvenlik ve Giriş Katmanı (yüksek öncelik)

| # | Modül | Dosya (önerilen) | Test edilecekler |
|---|--------|------------------|-------------------|
| 1 | CORS | `tests/unit/cors.test.ts` | `parseAllowedOrigins()` (prod’da boş/wildcard → throw), `isOriginAllowed()` (exact, subdomain, reject) |
| 2 | Call-event body (Zod) | `tests/unit/callEventSchema.test.ts` | Payload şeması: `value: null` kabul, eksik zorunlu alan 400, geçerli payload parse |
| 3 | Cron Watchtower auth | `tests/unit/cronWatchtowerAuth.test.ts` | CRON_SECRET yok + production → 500; Bearer yanlış → 401; Bearer doğru → devam (mock) |

### Faz 2 — Servis Mantığı (orta öncelik)

| # | Modül | Dosya (önerilen) | Test edilecekler |
|---|--------|------------------|-------------------|
| 4 | timingSafeCompare | `tests/unit/timingSafeCompare.test.ts` | Eşit / eşit değil; uzunluk farkı; boş string |
| 5 | Source classifier | `tests/unit/sourceClassifier.test.ts` | `classifySource()` — organic, cpc, referral (en az 2–3 senaryo) |
| 6 | Attribution | `tests/unit/attribution.test.ts` | UTM / GCLID / referrer → source/medium (sadece pure function’lar) |

### Faz 3 — Yardımcılar ve Edge Case (düşük öncelik)

| # | Modül | Dosya (önerilen) | Test edilecekler |
|---|--------|------------------|-------------------|
| 7 | Logger | `tests/unit/logger.test.ts` | Logger çağrıları hata fırlatmaz (smoke) |
| 8 | today-range / time | `tests/unit/todayRange.test.ts` | `getTodayTrtUtcRange()` tipi ve dönüş yapısı (TRT günü) |

---

## 3. Teknik Kurallar

- **Runner:** `node:test` + `node:assert` (mevcut pattern).
- **Import:** TypeScript için `node --import tsx --test` kullanılacak.
- **Mock:** DB/HTTP gerektiren testlerde mock (Supabase client, fetch) kullan; gerçek ağ/DB yok.
- **CI:** Faz 1 bittikten sonra `package.json`’a `"test:unit": "node --import tsx --test tests/unit/*.test.ts"` eklenebilir; isteğe bağlı GitHub Action adımı.

---

## 4. Başarı Kriterleri

| Hedef | Ölçüt |
|-------|--------|
| Faz 1 tamamlandı | CORS + call-event schema + cron auth testleri yazıldı ve yeşil. |
| Regresyon yok | `npm run build` ve mevcut E2E/smoke kırılmıyor. |
| Dokümantasyon | Bu plan güncel; yeni test dosyası eklendiğinde bu tabloya satır eklenir. |

---

## 5. Sıradaki Adım

**Önerilen ilk iş:** `tests/unit/cors.test.ts` — CORS prod’da fail-closed ve origin eşleşmesi en kritik güvenlik davranışı; mevcut `lib/cors.ts` saf fonksiyon olduğu için mock gerektirmez, hızlı yazılır.

Bu plan `docs/AUDIT/UNIT_TEST_PLAN.md` olarak tutulacak; ilerleme bu dosyadan takip edilebilir.
