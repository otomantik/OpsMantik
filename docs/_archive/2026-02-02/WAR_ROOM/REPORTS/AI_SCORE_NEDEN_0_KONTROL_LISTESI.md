# AI Score Neden 0? — Kontrol Listesi

**Tarih:** 2026-01-30  
**Sorun:** Hunter Card’da (ve RPC’de) `ai_score` hep 0 geliyor; OpenAI token alındı, entegrasyon çalışıyor mu?

---

## AI Nasıl Çalışıyor? (Kısa Özet)

1. **Ziyaretçi** sitede telefon veya WhatsApp tıklıyor → `/api/sync` bir satır **`calls`** tablosuna yazar (`source='click'`, `intent_action='phone'` veya `'whatsapp'`).
2. **DB trigger** (`calls_notify_hunter_ai`) bu INSERT’ten sonra tetiklenir → **pg_net** ile `hunter-ai` Edge Function’a HTTP POST atar.
3. **hunter-ai** (Supabase Edge Function):
   - Session + timeline çeker,
   - OpenAI’ya prompt gönderir,
   - Dönen `ai_score`, `ai_summary`, `ai_tags` değerlerini **`sessions`** tablosuna yazar.
4. Dashboard `get_recent_intents_v2` ile bu session’ı okur → **ai_score** kartta görünür.

**Eksik / hatalı bir adım olursa** session güncellenmez → ai_score hep **0** (default) kalır.

---

## Kontrol Listesi (Sırayla)

### 1. pg_net Açık mı?

- **Supabase Dashboard** → **Database** → **Extensions**
- **pg_net** extension’ı **Enable** olmalı (trigger bu sayede HTTP POST atıyor).

Yoksa: Enable et, migration’lar zaten trigger’ı kurmuş olacak.

---

### 2. `private.api_keys` Dolu mu?

Trigger, Edge Function’a istek atabilmek için **Supabase proje URL** ve **service_role key** okuyor. Bunlar **private.api_keys** tablosunda olmalı.

**Supabase Dashboard** → **SQL Editor** → aşağıyı çalıştır (sadece kontrol; değerleri göstermeyin):

```sql
-- Kaç satır var? 2 olmalı (project_url, service_role_key)
SELECT key_name FROM private.api_keys;
```

- **0 satır** veya **1 satır** → Eksik. Şunu çalıştırın (kendi proje bilgilerinizle):

```sql
INSERT INTO private.api_keys (key_name, key_value) VALUES
  ('project_url', 'https://SENIN-PROJE-REF.supabase.co'),
  ('service_role_key', 'eyJ...SERVICE_ROLE_KEY_BURAYA...')
ON CONFLICT (key_name) DO UPDATE SET key_value = EXCLUDED.key_value;
```

- **project_url:** Dashboard → Settings → API → Project URL  
- **service_role_key:** Dashboard → Settings → API → Project API keys → `service_role` (secret)

---

### 3. hunter-ai Edge Function Deploy Edilmiş mi?

- **Supabase Dashboard** → **Edge Functions** → **hunter-ai** var mı?

Yoksa:

```bash
supabase functions deploy hunter-ai
```

Proje linkli (`supabase link`) olmalı.

---

### 4. OPENAI_API_KEY Edge Function’da Tanımlı mı?

AI skorunu OpenAI hesaplıyor; key **Edge Function secret** olarak verilmeli.

- **Dashboard** → **Edge Functions** → **hunter-ai** → **Secrets**  
  - **OPENAI_API_KEY** = `sk-...` (OpenAI API key) var mı?

Yoksa:

```bash
supabase secrets set OPENAI_API_KEY=sk-proj-...
```

Veya Dashboard’dan hunter-ai → Secrets → Add secret: `OPENAI_API_KEY`, value = OpenAI key.

---

### 5. Call Gerçekten “High-Intent” mı? (Trigger Tetikleniyor mu?)

Trigger **sadece** şu koşulda çalışır:

- `source = 'click'`
- `intent_action` **tam olarak** `'phone'` veya `'whatsapp'`

**Form** veya başka bir aksiyonla oluşan call’lar tetiklemez.  
Sync tarafında şu an sadece telefon/WhatsApp tıkları `calls`’a yazılıyor; yani bu koşul genelde sağlanıyor.

Kontrol için (SQL Editor):

```sql
-- Son eklenen high-intent call'lar
SELECT id, intent_action, matched_session_id, created_at
FROM public.calls
WHERE source = 'click' AND intent_action IN ('phone', 'whatsapp')
ORDER BY created_at DESC
LIMIT 5;
```

`matched_session_id` **NULL** olan satırlar için hunter-ai zaten hata verir (session bulunamaz); böyle call’lar için ai_score güncellenmez.

---

### 6. hunter-ai Loglarına Bakın

Trigger çalışıyor olsa bile Edge Function hata alıyorsa session güncellenmez.

- **Dashboard** → **Edge Functions** → **hunter-ai** → **Logs**

Bakılacaklar:

- **İstek geliyor mu?** (Call insert sonrası birkaç saniye içinde log olmalı.)
  - Hiç istek yok → büyük ihtimalle pg_net veya **private.api_keys** (project_url / service_role_key) sorunu.
- **500 / OpenAI hatası** → OPENAI_API_KEY yanlış / süresi dolmuş / kota vb.
- **“Session lookup failed” / “matched_session_id”** → O call için session eşleşmemiş.

---

## Özet Tablo

| Kontrol | Nerede | Ne yapmalı |
|--------|--------|------------|
| pg_net | Database → Extensions | Enable |
| project_url + service_role_key | private.api_keys (SQL) | INSERT/UPDATE ile ekle |
| hunter-ai deploy | Edge Functions | `supabase functions deploy hunter-ai` |
| OPENAI_API_KEY | hunter-ai → Secrets | Dashboard veya `supabase secrets set` |
| High-intent call | calls tablosu | source=click, intent_action in (phone, whatsapp), matched_session_id NOT NULL |
| Hata ayıklama | hunter-ai → Logs | İstek geliyor mu, 500/OpenAI hatası var mı bak |

Hepsi tamamsa: yeni bir **telefon veya WhatsApp tıklaması** yapıp 10–30 saniye sonra ilgili session için **ai_score** (ve varsa **ai_summary**) dolmalı. Hâlâ 0 ise **hunter-ai Logs** ve **OpenAI API key / kota** tarafını kontrol edin.

---

## Kanıt / Test (Çalışıyor mu?)

**1) Node script (yerel)**  
Proje kökünde `.env.local` ile:

```bash
npm run verify:ai-pipeline
```

Çıktıda: high-intent call sayısı, AI doldurulmuş session sayısı, “pipeline çalışıyor” veya “sorun var” özeti.

**2) SQL (Supabase SQL Editor)**  
`docs/WAR_ROOM/SQL_AI_PIPELINE_EVIDENCE.sql` dosyasındaki sorguları kopyalayıp SQL Editor’da çalıştır. Sonuçlar: high-intent call sayısı, AI dolu session sayısı, son call’ların session’ında ai_score var mı, `private.api_keys` satırları.
