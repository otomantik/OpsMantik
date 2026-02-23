# Hunter Kart Düzeltmeleri — Gemini'ye Anlat

**Tarih:** 2026-01-31  
**Amaç:** Karttaki yanlışlıklar, Match/Campaign/Device/EST VALUE ve veritabanındaki GCLID tablolarında null kalan alanlar için yapılacaklar listesi.

---

## 1. Keyword = UTM keyword (utm_term) olacak

**Sorun:** Kartta Keyword alanı path’ten türetilen kelimelerle (İstanbul, Antika, Alan, Yerler vb.) doluyor; bu UTM keyword değil.

**Yapılan:** HunterCard’da Keyword artık **sadece** `utm_term` gösteriyor; path/campaign fallback kaldırıldı. `utm_term` yoksa "—" gösterilir.

**Veri tarafı:** Keyword’ün dolması için `sessions.utm_term` dolu olmalı. Bu da:
- Sync: URL’de `utm_term` (veya şablondaki `{keyword}`) gelince yazılıyor.
- Backfill: `20260130250700_backfill_sessions_utm_from_entry_page.sql` GCLID’li session’larda `entry_page` query string’inden `utm_term` parse edip yazıyor. Migration çalıştırıldıysa ve `entry_page`’de `utm_term=` varsa dolar.

---

## 2. Match = GCLID kayıtlı UTMs’ten (matchtype)

**Sorun:** Match alanı "—" görünüyor; e/p/b (Exact/Phrase/Broad) gelmiyor.

**Kaynak:** `sessions.matchtype` (Google Ads: e=Exact, p=Phrase, b=Broad). RPC `get_recent_intents_v2` bu alanı session’dan döndürüyor.

**Yapılacaklar:**
- Backfill migration’ın çalıştığından emin ol: GCLID’li ve `entry_page`’de `?` olan session’larda `matchtype` URL’den parse edilip yazılıyor.
- Hâlâ null ise: `entry_page` query’siz kaydedilmiş olabilir. O zaman **events tablosundan** backfill: ilk event’in `url` veya `metadata` içindeki URL’den `matchtype=` parse edilip session’a yazılabilir (ikinci bir migration/script).

---

## 3. Campaign = UTM campaign eşleştirmesi

**Sorun:** Campaign "—" görünüyor.

**Kaynak:** `sessions.utm_campaign` (veya `utm_campaign_id`). RPC zaten session’dan döndürüyor.

**Yapılacaklar:**
- Aynı backfill migration `utm_campaign`’ı da `entry_page`’den dolduruyor. Migration çalıştırıldı mı kontrol et.
- Null kalanlar için: yine **events’ten** ilk isteğin URL’i kullanılarak `utm_campaign=` parse edilip session’a yazılacak bir ek backfill yazılabilir.

---

## 4. Device = Telefon, iPhone, Samsung gibi detay

**Sorun:** Sadece "mobile" yazıyor; kullanıcı "telefon", "iPhone", "Samsung" gibi daha anlamlı bir etiket istiyor.

**Mevcut:** Sync’te `lib/geo.ts` (UAParser) ile `device_type` (mobile/desktop/tablet) ve `os` (örn. "iOS", "Android") çıkarılıyor; şu an sadece `device_type` session’a yazılıyor.

**Yapılacaklar:**
- **Seçenek A:** Session’a `device_os` (veya `device_label`) ekle; sync’te UAParser’dan gelen `os` (ve gerekirse model) yazılsın; RPC’de dönsün; kartta Device satırında `device_os` veya `device_type + device_os` göster (örn. "Mobile · iPhone").
- **Seçenek B:** RPC’de session’a join edilen bir alan yoksa, events’teki ilk event’in `metadata` içinde user_agent saklıysa, oradan parse edip RPC’de hesaplanan bir “device_label” döndürülebilir (daha az tercih edilir; tek kaynak session olmalı).

Özet: **device_os** (veya tek bir “device_label”) kolonu ekleyip sync + RPC + HunterCard’da kullanmak.

---

## 5. EST. VALUE boş — AI / Casino

**Sorun:** EST. VALUE "—" görünüyor; kullanıcı bunu “AI işi çalışmıyor” diye niteliyor.

**Ayrım:**
- **EST. VALUE** kartta: `calls.estimated_value` (ve `calls.currency`). Bu alan, kullanıcı “Seal deal” ile tutarı seçip onayladığında doldurulur (Casino/bounty chip). Yani **manuel** veya iş akışına bağlı; doğrudan “Hunter AI” skorundan gelmiyor.
- **Score** (örn. 20): `sessions.ai_score` — bu Hunter AI (OpenAI) pipeline’ından gelir. Bu pipeline çalışmıyorsa `ai_score` 0 kalır (bak: `docs/WAR_ROOM/REPORTS/AI_SCORE_NEDEN_0_KONTROL_LISTESI.md`).

**Yapılacaklar:**
- **EST. VALUE dolsun istiyorsan:**  
  - Seal deal akışında tutar seçilip kaydedildiğinde `calls.estimated_value` ve `calls.currency` set ediliyor mu kontrol et.  
  - İstersen “varsayılan tahmini değer” (ör. lead skoruna göre) da atanabilir; bu ayrı bir özellik.
- **AI skor (Score) dolsun istiyorsan:**  
  Hunter AI pipeline’ını çalıştır: pg_net, `private.api_keys`, hunter-ai deploy, OPENAI_API_KEY, trigger (phone/whatsapp call insert). Detay: `AI_SCORE_NEDEN_0_KONTROL_LISTESI.md` ve `npm run verify:ai-pipeline`.

---

## 6. Veritabanındaki GCLID tablolarında null’lar

**Sorun:** GCLID’li session’larda UTM / matchtype / campaign hâlâ null; “gclid tablolarında null olanlar daha düzelmedi” deniyor.

**Yapılan:**
- Migration `20260130250700_backfill_sessions_utm_from_entry_page.sql`: GCLID’li ve `entry_page`’de `?` olan tüm session’larda, URL query string’inden `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `matchtype`, `network`, `placement`, `device` parse edilip ilgili sütunlara yazılıyor (COALESCE ile sadece boş alanlar dolduruluyor).

**Yapılacaklar:**
1. Bu migration’ın gerçekten çalıştığını doğrula:  
   `supabase migration list` / `supabase db push` veya remote’da migration’ların uygulandığını kontrol et.
2. Hâlâ null olan kayıtlar varsa muhtemel neden: **entry_page query string içermiyor** (redirect ile temiz URL’e düşmüş veya ilk event URL’i farklı). O zaman:
   - **Events’ten backfill:** GCLID’li session’lar için ilgili session’ın **ilk event’inin** `url` (veya `metadata->url` / request URL’i) alınır; bu URL’den aynı parametreler parse edilip session’a UPDATE ile yazılır. Bunu yapan ikinci bir migration veya script yazılabilir (ör. `events.url` veya `metadata` içinde URL varsa kullan).
3. İleride null kalmaması için: Sync tarafında GCLID/UTM geldiğinde session’ın güncellendiğinden emin ol (zaten `hasNewClickId` / `hasNewUTM` ile yapılıyor); tracking script’in **ilk istekte** tam landing URL’ini (query string ile) göndermesini sağla.

---

## Özet tablo (Gemini için)

| Konu | Ne yapıldı / Nereden geliyor | Ne yapılacak |
|------|------------------------------|--------------|
| **Keyword** | Sadece `utm_term`; path fallback kaldırıldı | Backfill + sync ile `sessions.utm_term` doldurulmalı |
| **Match** | `sessions.matchtype` (e/p/b) | Backfill migration çalıştır; null kalanlar için events’ten URL ile backfill |
| **Campaign** | `sessions.utm_campaign` | Aynı backfill; gerekirse events’ten |
| **Device** | Şu an sadece `device_type` (mobile/desktop/tablet) | Session’a device_os/label ekle; sync + RPC + kartta “iPhone/Samsung” vb. göster |
| **EST. VALUE** | `calls.estimated_value` (Seal deal ile set) | Seal akışında değer yazılıyor mu kontrol et; istenirse varsayılan/AI tahmini eklenebilir |
| **AI Score** | `sessions.ai_score` (Hunter AI) | Pipeline’ı aç: pg_net, api_keys, hunter-ai, OPENAI_API_KEY; `verify:ai-pipeline` ile doğrula |
| **GCLID null’lar** | Backfill: entry_page’den UTM/matchtype/ads alanları | Migration’ı çalıştır; entry_page’de param yoksa events’ten URL ile ikinci backfill |

---

## Kısa teknik referanslar

- **Backfill migration:** `supabase/migrations/20260130250700_backfill_sessions_utm_from_entry_page.sql`
- **Sync’te GCLID/UTM yazımı:** `app/api/sync/route.ts` (hasNewClickId / hasNewUTM ile session update)
- **Kart Keyword/Match/Campaign:** `components/dashboard-v2/HunterCard.tsx` (keywordDisplay = sadece utm_term; Match = matchtype; Campaign = utm_campaign)
- **AI pipeline kontrol:** `docs/WAR_ROOM/REPORTS/AI_SCORE_NEDEN_0_KONTROL_LISTESI.md`, `npm run verify:ai-pipeline`
- **RPC:** `get_recent_intents_v2` session’dan utm_*, matchtype, device_type, ads_network/placement ve calls’tan estimated_value/currency döndürüyor.

Bu doküman Gemini’ye (veya başka bir geliştiriciye) Hunter kartı ve GCLID/UTM null’larını düzeltmek için yapılacakları tek yerden anlatmak için yazıldı.
