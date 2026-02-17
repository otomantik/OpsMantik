# OCI Smoke Test & War Room Yol Haritası

## 1. Final Smoke Test (Uçtan Uca)

Worker'ı manuel tetikleyip veritabanı güncellemelerini doğrulayın.

### Adım A: Kuyruğa test işi at

**Şema notu:** `offline_conversion_queue` tablosunda `sale_id` zorunlu ve `sales(id)` referansı var; `value_cents` kullanılıyor (conversion_value değil); hata mesajı `last_error` sütununda (google_error_message yok).

**Seçenek 1 — Otomatik (tercih):** Henüz kuyruğa girmemiş bir satışı kullan. Aşağıdaki tek satır ekler (uygun ilk satışı seçer).

```sql
-- Supabase SQL Editor (service_role veya backend ile çalıştır).
-- Kuyrukta olmayan ve site'ında google_ads credential olan bir sale kullanır.
INSERT INTO public.offline_conversion_queue (
  site_id,
  sale_id,
  provider_key,
  gclid,
  conversion_time,
  value_cents,
  currency,
  status,
  created_at,
  updated_at,
  next_retry_at
)
SELECT
  s.site_id,
  s.id,
  'google_ads',
  'TeSt_GCLID_Production_Run_01',
  NOW(),
  25000,
  'TRY',
  'QUEUED',
  NOW(),
  NOW(),
  NOW()
FROM public.sales s
WHERE NOT EXISTS (SELECT 1 FROM public.offline_conversion_queue oq WHERE oq.sale_id = s.id)
  AND EXISTS (
    SELECT 1 FROM public.provider_credentials pc
    WHERE pc.site_id = s.site_id
      AND pc.provider_key = 'google_ads'
      AND pc.is_active = true
  )
LIMIT 1;
```

**Seçenek 2 — Manuel:** Eğer yukarıdaki 0 satır ekliyorsa (uygun sale yok), kendi `site_id` ve `sale_id` değerlerinizi kullanın:

```sql
INSERT INTO public.offline_conversion_queue (
  site_id,
  sale_id,
  provider_key,
  gclid,
  conversion_time,
  value_cents,
  currency,
  status,
  created_at,
  updated_at,
  next_retry_at
) VALUES (
  '<GERÇEK_SITE_UUID>',
  '<GERÇEK_SALE_UUID>',
  'google_ads',
  'TeSt_GCLID_Production_Run_01',
  NOW(),
  25000,
  'TRY',
  'QUEUED',
  NOW(),
  NOW(),
  NOW()
);
```

Bu kayıt yapısal olarak doğru; Google sahte GCLID nedeniyle hata döneceği için **Error Handling** (FAILED + last_error) test edilir.

**Seçenek 3 — Test satışı + kuyruk (hiç uygun satış yoksa):** Önce bir test satışı ekleyip sonra kuyruğa alın. Aşağıdaki `SITE_UUID` yerine kendi site_id'nizi yazın (örn. `e47f36f6-c277-4879-b2dc-07914a0632c2`). Önce **Adım 1**, sonra **Adım 2** çalıştırın.

```sql
-- Adım 1: Tek test satışı ekle
INSERT INTO public.sales (site_id, occurred_at, amount_cents, currency, status)
VALUES ('SITE_UUID', NOW(), 25000, 'TRY', 'CONFIRMED')
RETURNING id, site_id;

-- Adım 2: Dönen id'yi kopyalayıp aşağıda SALE_UUID yerine yapıştırın, SITE_UUID'yi de site_id ile değiştirin
INSERT INTO public.offline_conversion_queue (
  site_id, sale_id, provider_key, gclid, conversion_time, value_cents, currency, status, created_at, updated_at, next_retry_at
) VALUES (
  'SITE_UUID',
  'SALE_UUID',
  'google_ads',
  'TeSt_GCLID_Production_Run_01',
  NOW(),
  25000,
  'TRY',
  'QUEUED',
  NOW(),
  NOW(),
  NOW()
);
```

Tek blokta (tek seferde) yapmak isterseniz:

```sql
WITH new_sale AS (
  INSERT INTO public.sales (site_id, occurred_at, amount_cents, currency, status)
  VALUES ('e47f36f6-c277-4879-b2dc-07914a0632c2', NOW(), 25000, 'TRY', 'CONFIRMED')
  RETURNING id, site_id
)
INSERT INTO public.offline_conversion_queue (
  site_id, sale_id, provider_key, gclid, conversion_time, value_cents, currency, status, created_at, updated_at, next_retry_at
)
SELECT site_id, id, 'google_ads', 'TeSt_GCLID_Production_Run_01', NOW(), 25000, 'TRY', 'QUEUED', NOW(), NOW(), NOW()
FROM new_sale;
```

(Bu son blokta site_id sabit; farklı site için ilk `VALUES` içindeki UUID'yi değiştirin.)

---

### Adım B: Worker'ı manuel tetikle

`.env.local` içindeki `CRON_SECRET` değerini kullanın (örnekteki yer tutucuyu değiştirin):

**PowerShell (Windows):** Windows'ta `curl` farklı çalışır; aşağıdaki kullanın:

```powershell
$secret = "CRON_SECRET_BURAYA"   # .env.local içindeki CRON_SECRET
Invoke-WebRequest -Uri "http://localhost:3000/api/workers/google-ads-oci" -Method POST -Headers @{ "Authorization" = "Bearer $secret"; "Content-Type" = "application/json" }
```

Yanıt gövdesini görmek için: `(Invoke-WebRequest ...).Content`

**Bash / WSL / Git Bash:**

```bash
curl -X POST http://localhost:3000/api/workers/google-ads-oci \
  -H "Authorization: Bearer CRON_SECRET_BURAYA" \
  -H "Content-Type: application/json"
```

**Örnek (gerçek secret ile):**

```bash
curl -X POST http://localhost:3000/api/workers/google-ads-oci \
  -H "Authorization: Bearer cwTRy86PGtpxMB1mvljACSXrKFNWb74q" \
  -H "Content-Type: application/json"
```

**Beklenen yanıt:**

```json
{
  "ok": true,
  "processed": 1,
  "completed": 0,
  "failed": 1,
  "retry": 0
}
```

Google sahte GCLID’i kabul etmeyeceği için `failed: 1` normaldir.

---

### Adım C: Veritabanı sonucunu kontrol et

Hata mesajı sütunu **`last_error`** (projede `google_error_message` yok):

```sql
SELECT id, status, last_error, retry_count, updated_at
FROM public.offline_conversion_queue
WHERE gclid = 'TeSt_GCLID_Production_Run_01';
```

**Beklenen:**

| status | last_error (örnek)        | retry_count | updated_at   |
|--------|----------------------------|-------------|--------------|
| FAILED | UNPARSEABLE_GCLID veya ... | 0           | Şimdiki zaman |

Bu tablo çıktısı + worker JSON yanıtı, motorun (claim → credential → adapter → DB güncelleme) uçtan uca çalıştığını doğrular.

---

## 2. Sırada Ne Var? War Room (Dashboard)

Backend hazır; sırada bu verileri gösteren arayüz var.

### Hedef kullanıcı deneyimi

1. **Hangi satışlar Google’a gitti?**  
   Yeşil tik (örn. `status = 'COMPLETED'`).

2. **Hangileri hata aldı?**  
   Kırmızı ünlem + tooltip: `last_error` (ör. "GCLID süresi dolmuş", "UNPARSEABLE_GCLID").

3. **Manuel tetikleme:**  
   "Hemen Gönder" butonu (acil durumda worker’ı manuel tetikler veya sadece seçili işleri yeniden kuyruğa alır).

### Veri kaynağı

- **Tablo:** `offline_conversion_queue` (ve isteğe göre `sales` ile join).
- **Sütunlar:** `id`, `site_id`, `sale_id`, `status`, `last_error`, `retry_count`, `updated_at`, `gclid`, `value_cents`, `currency`, `provider_key`, vb.
- **Filtre:** `site_id` = mevcut site (RLS / yetki ile).

### Önerilen uygulama adımları

1. **API (opsiyonel):**  
   - `GET /api/sites/[siteId]/oci-queue` (veya mevcut bir list endpoint’i):  
     `offline_conversion_queue` + gerekirse `sales` alanları, sayfalama.

2. **Sayfa:**  
   - Örn. `app/(dashboard)/sites/[id]/war-room/page.tsx` veya mevcut bir “Satışlar / Dönüşümler” sayfasına sekme/blok.

3. **UI bileşenleri:**  
   - Tablo/liste: satır başına `status` (COMPLETED / FAILED / RETRY / QUEUED / PROCESSING).  
   - COMPLETED → yeşil tik.  
   - FAILED / RETRY → kırmızı ünlem + `last_error` tooltip.  
   - "Hemen Gönder" → `POST /api/workers/google-ads-oci` (CRON_SECRET’ı sadece backend’de kullan; buton backend’e istek atan bir endpoint’i tetiklesin, örn. `POST /api/sites/[siteId]/oci-trigger`).

4. **Güvenlik:**  
   - "Hemen Gönder" sadece yetkili kullanıcılar için (örn. site admin / role check).  
   - CRON_SECRET asla client’a gönderilmez; tetikleme sunucu tarafında yapılır.

Bu doküman smoke test adımlarını sabitledi; War Room için bir sonraki büyük adım yukarıdaki API + sayfa + UI’dır.
