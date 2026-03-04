# OCI: GCLID "Kodu Çözülemedi" — Başarısız Kayıtları Yeniden Gönderme

## Sorun
Google Ads offline conversion import bazen şu hatayı döner:
- **TR:** "İçe aktarılan GCLID'nin kodu çözülemedi. Tıklama kimliklerinin doğru biçimlendirildiğinden emin olun."
- **EN:** GCLID could not be decoded / UNPARSEABLE_GCLID

Bu genelde URL’den gelen **base64url** formatındaki GCLID’nin (`_` ve `-` içeren) Google’ın beklediği **standart Base64** formatına çevrilmeden gönderilmesinden kaynaklanır.

## Kod Tarafı (Yapıldı)
`lib/providers/google_ads/mapper.ts` içinde `normalizeClickIdForGoogle()` eklendi: API’ye göndermeden önce gclid/wbraid/gbraid base64url → standart base64 dönüştürülüyor (`_`→`/`, `-`→`+`). Yeni gönderimler bu sayede kabul edilir.

## Gidemeyen (FAILED) Kayıtları Tekrar Göndermek

Bu kayıtlar `offline_conversion_queue` tablosunda `status = 'FAILED'` ve muhtemelen `last_error` içinde "GCLID" / "decode" / "çözülemedi" geçiyor. Claim sadece `QUEUED` ve `RETRY` satırları alır; FAILED’ları tekrar denemek için **reset** gerekir.

### 1) Sadece GCLID/decode hatası alan satırları sıfırla (önerilen)

Supabase SQL Editor’da (veya `psql` ile) çalıştır:

```sql
-- GCLID decode / unparseable hatası almış FAILED satırları tekrar kuyruğa al
-- not: next_retry_at NOT NULL; hemen claim edilsin diye geçmiş zaman
UPDATE public.offline_conversion_queue
SET
  status         = 'QUEUED',
  next_retry_at  = now() - interval '1 minute',
  retry_count    = 0,
  last_error     = NULL,
  provider_error_code = NULL,
  provider_error_category = NULL,
  claimed_at     = NULL,
  updated_at     = now()
WHERE status = 'FAILED'
  AND (
    last_error ILIKE '%gclid%'
    OR last_error ILIKE '%decode%'
    OR last_error ILIKE '%çözülemedi%'
    OR last_error ILIKE '%unparseable%'
    OR last_error ILIKE '%click%id%'
  );
```

Kaç satır güncellendiğini görmek için:

```sql
-- Önce kaç satır etkilenecek (dry-run)
SELECT id, call_id, gclid, last_error, retry_count
FROM public.offline_conversion_queue
WHERE status = 'FAILED'
  AND (
    last_error ILIKE '%gclid%'
    OR last_error ILIKE '%decode%'
    OR last_error ILIKE '%çözülemedi%'
    OR last_error ILIKE '%unparseable%'
    OR last_error ILIKE '%click%id%'
  );
```

### 2) Belirli bir call_id’yi sıfırla

Sadece tek bir conversion’ı yeniden göndermek istiyorsan (ör. `call_id` biliyorsan):

```sql
UPDATE public.offline_conversion_queue
SET
  status         = 'QUEUED',
  next_retry_at  = now() - interval '1 minute',
  retry_count    = 0,
  last_error     = NULL,
  provider_error_code = NULL,
  provider_error_category = NULL,
  claimed_at     = NULL,
  updated_at     = now()
WHERE status = 'FAILED'
  AND call_id = '<CALL_UUID_BURAYA>';
```

### 3) Sonrası
- Deploy’da mapper değişikliği (base64url → base64) canlıda olmalı.
- Worker veya cron bir sonraki çalışmada bu satırları `QUEUED` olarak claim edip tekrar Google’a gönderecek; GCLID artık normalize edildiği için başarılı olması beklenir.

## INVALID_CLICK_ID_FORMAT — Neden Alıyoruz?

Google Ads API bu hatayı, gönderilen **tıklama kimliğinin (GCLID / wbraid / gbraid) formatının geçersiz veya parse edilemez** olduğunu söylediğinde döner. Bizde string standart base64 görünse bile aşağıdaki nedenlerle reddedilebilir:

| Neden | Açıklama |
|--------|----------|
| **Sadece bir ID gönderilmeli** | Aynı conversion için hem `gclid` hem `gbraid`/`wbraid` gönderilirse API hata verebilir. Backend mapper tek ID gönderiyor (gclid > wbraid > gbraid) ama kuyrukta **hem gclid hem gbraid dolu** satırlarda bazı hesaplar yine de reddedebilir; kuyrukta **sadece gclid** bırakmak işe yarar. |
| **Hesap gbraid/wbraid kabul etmiyor** | Bazı hesaplar veya conversion action’lar sadece **gclid** kabul eder. Sadece gbraid olan satırlar `INVALID_CLICK_ID_FORMAT` alır; session’dan gclid backfill veya GCLID bridge gerekir. |
| **Yanlış encoding** | URL’den gelen base64url (`_`, `-`) standart base64’e çevrilmeli (`lib/providers/google_ads/mapper.ts` → `normalizeClickIdForGoogle`). Eski/bozuk kayıtlar normalize edilmeden gönderilmiş olabilir. |
| **Tıklama bu hesaba ait değil** | GCLID başka bir Google Ads müşterisine (veya SA360/DV360) aitse API “click not found” veya format hatası dönebilir. |
| **Süresi dolmuş tıklama** | Google tıklamaları genelde **90 gün** saklar; conversion daha eski bir tıklamaya bağlanıyorsa reddedilebilir. |

Backend’de her conversion için **tek** click ID gönderiliyor (gclid varsa o, yoksa wbraid, yoksa gbraid). Sorun çoğunlukla: kuyrukta birden fazla ID dolu olması, hesabın gbraid kabul etmemesi veya ID’nin bu hesaba/geçerlilik süresine ait olmamasıdır.

## INVALID_CLICK_ID_FORMAT (Muratcan) — Ne Yapılır?

Hata "GCLID decode" değil **INVALID_CLICK_ID_FORMAT** ise ve GCLID'ler zaten standart base64 ise:

1. **Kontrol:** `node scripts/db/oci-check-muratcan-gclids.mjs`
2. **Hem gclid hem gbraid olanlar:** `node scripts/db/oci-muratcan-only-gclid.mjs`
3. **Sadece gbraid olanlar:** önce session'dan gclid dene, yoksa **GCLID Bridge**:
   - `node scripts/db/oci-muratcan-backfill-gclid-from-session.mjs` (mevcut session'da gclid)
   - `node scripts/db/oci-muratcan-gclid-bridge.mjs` (aynı fingerprint, son 14 gün, GCLID'li başka session)
4. FAILED satırları tekrar kuyruğa al (QUEUED + next_retry_at geçmişe), sonra OCI worker/cron çalıştır.

## GCLID Bridge (Fingerprint-to-GCLID)

Aynı kullanıcı (matched_fingerprint) son 14 gün içinde GCLID'li başka bir session açmışsa, o session'ın GCLID'ini kuyruk satırına yazar; böylece sadece gbraid olan conversion GCLID ile gönderilebilir.

```bash
node scripts/db/oci-muratcan-gclid-bridge.mjs          # çalıştır
node scripts/db/oci-muratcan-gclid-bridge.mjs --dry-run # sadece kontrol
```

## Özet
| Adım | Ne yapılır |
|------|------------|
| 1 | Mapper fix deploy (base64url normalizasyonu) |
| 2 | Yukarıdaki SQL ile ilgili FAILED satırları `status='QUEUED'`, `retry_count=0`, `last_error=NULL` yap |
| 3 | OCI worker/cron’u çalıştır (veya bir sonraki zamanlanmış çalışmayı bekle) |
