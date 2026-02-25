# Unit Test Failures Analizi (25 Şubat 2026)

**Özet:** `npm run test:unit` çalıştırıldığında 314 testten 13’ü fail ediyor. Aşağıda her failure’ın nedeni ve yapılacak aksiyon özetlenmiştir.

---

## 1. Scoring V1.1 (bizim kapsam) — DÜZELTİLDİ

| Test | Dosya | Durum |
|------|--------|--------|
| `deriveCallStatus: confidence < 50 => suspicious even if elapsed high` | `compute-score-v1_1.test.ts` | **Düzeltildi** |

**Neden:** Girdiler `hasClickId=false`, `elapsedSeconds=200`, `eventCount=1` ile confidence = 100 − 25 − 10 = **65** hesaplanıyordu; test ise `confidence < 50` bekliyordu. 200s ≥ 30 olduğu için “fast” kesintisi yok; bu yüzden bu girdilerle confidence hiç < 50 olmuyor.

**Yapılan:** Test girdileri `elapsedSeconds=10` (noClickId + fast + single → confidence 45) olacak şekilde güncellendi; test adı “confidence < 50 => suspicious (noClickId + single + fast)” olarak netleştirildi.

---

## 2. Compliance Freeze (mevcut kod / mimari)

| Test | Dosya | Önerilen aksiyon |
|------|--------|-------------------|
| COMPLIANCE: idempotency path unreachable when consent fails | `compliance-freeze.test.ts:47` | Route sırası kontrolü: Consent fail olduğunda **204 dönülmeden** idempotency (tryInsert) path’ine girilmemeli. Call-event route’unda consent reddi → 204 dönüş sırası kodda doğrulanmalı; testin baktığı string/sıra güncellenmeli veya test gevşetilmeli. |
| COMPLIANCE: erase RPC preserves billing fields | `compliance-freeze.test.ts:128` | Test “erase RPC session_id’yi değiştirmemeli” diyor. Migration/RPC’de `session_id` (ve diğer billing alanları) erase sırasında korunuyor mu kontrol edilmeli; ya RPC düzeltilmeli ya da test beklentisi (ör. “preserve” tanımı) güncellenmeli. |

**Not:** Bu testler Scoring V1.1 PR kapsamı dışında; ayrı bir compliance/PR’da ele alınmalı.

---

## 3. i18n / translate (API veya test beklentisi)

| Test | Dosya | Gözlem |
|------|--------|--------|
| translate: exact locale match | `i18n.test.ts:96` | Beklenen: `'Operations Center'`, actual: `'en'` — Test çeviri metni beklerken locale kodu dönüyor; `translate()` imzası veya dönüş değeri değişmiş olabilir. |
| translate: locale prefix fallback (tr-TR -> tr) | `i18n.test.ts:101` | Beklenen: `'Operasyon Merkezi'`, actual: `'tr-TR'` — Aynı şekilde locale kodu dönüyor. |
| translate: fallback to en when key missing in locale | `i18n.test.ts:106` | Beklenen: `'Operations Center'`, actual: `'de'`. |
| translate: fallback to key when missing everywhere | `i18n.test.ts:110` | Beklenen: `'unknown.key.xyz'`, actual: `'en'`. |

**Öneri:** `translate()` fonksiyonunun mevcut imzası ve dönüş değeri (key / locale / metin) dokümante edilip testler buna göre güncellenmeli; veya API eski davranışa (çeviri metni döndürme) getirilmelidir. Kapsam: i18n, UI değil; test/impl uyumu.

---

## 4. Revenue Kernel / PR gate (sıra ve davranış)

| Test | Dosya | Önerilen aksiyon |
|------|--------|-------------------|
| PR gate: duplicate path returns 200 with x-opsmantik-dedup and MUST NOT publish | `revenue-kernel-gates.test.ts:28` | Duplicate path’te önce 200 + dedup header dönülüp publish yapılmadığı doğrulanmalı; test source’ta “dedup before publish” sırası string/akış ile eşleşmiyor olabilir. |
| PR gate: evaluation order Auth -> Rate limit -> Idempotency -> Quota -> Publish | `revenue-kernel-gates.test.ts:50` | Test “Quota before Publish” sırasını arıyor; ingest route’undaki middleware/sıra buna göre düzeltilmeli veya test güncellenmeli. |
| PR gate: quota reject path does not publish or write fallback | `revenue-kernel-gates.test.ts:59` | Quota reddinde publish ve fallback yazılmadığı garanti edilmeli. |
| PR gate: quota reject sets x-opsmantik-quota-exceeded and not x-opsmantik-ratelimit | `revenue-kernel-gates.test.ts:68` | Quota reject path’inde response header’da `x-opsmantik-quota-exceeded` set edildiği, `decision.headers` spread’inin kullanıldığı doğrulanmalı. |
| PR gate: QStash failure path writes fallback after idempotency | `revenue-kernel-gates.test.ts:88` | QStash hata path’inde önce idempotency row, sonra fallback insert sırası testle uyumlu hale getirilmeli. |
| PR gate: idempotency DB error must return 500 and MUST NOT publish | `revenue-kernel-gates.test.ts:99` | Idempotency DB hatasında 500 dönülüp publish yapılmadığı (fail-secure) garanti edilmeli. |

**Not:** Bunlar ingest/revenue kernel mimari testleri; Scoring V1.1’den bağımsız. Ayrı bir PR’da route sırası ve hata path’leri gözden geçirilmelidir.

---

## Yapılacaklar Özeti

| Öncelik | Ne | Nerede |
|--------|----|--------|
| Yapıldı | Scoring test: confidence < 50 senaryosunu doğru girdilerle düzelt | `tests/unit/compute-score-v1_1.test.ts` |
| Sonra | Compliance: consent → 204 sırası ve erase RPC billing/session_id koruması | call-event route + erase RPC + `compliance-freeze.test.ts` |
| Sonra | i18n: translate() dönüş değeri vs test beklentisi | `lib/.../translate` + `i18n.test.ts` |
| Sonra | Revenue kernel: dedup/quota/idempotency/publish sırası ve header’lar | ingest route + `revenue-kernel-gates.test.ts` |

**Scoring V1.1 PR için:** Sadece `compute-score-v1_1.test.ts` değişikliği bu PR’a aittir. Diğer 12 failure mevcut codebase’e ait; ayrı issue/PR’larda ele alınmalıdır.

---

## Test Komutu

```bash
npm run test:unit
```

Sadece scoring testlerini çalıştırmak (örnek):

```bash
node --import tsx --test tests/unit/compute-score-v1_1.test.ts
```
