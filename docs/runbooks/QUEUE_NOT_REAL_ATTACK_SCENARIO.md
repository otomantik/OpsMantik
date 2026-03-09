# Kuyruk gerçek değilse: Saldırı / sahte tıklama

Müşteri diyor ki: **Dashboard'da kuyrukta çok intent var ama reelde kimse aramadı, WhatsApp'tan yazmadı.**

Bu durumda olasılıklar:

1. **Saldırı / bot / sahte tıklama** – Otomatik veya script ile tel/WhatsApp linklerine tıklatılıyor; gerçek lead yok.
2. **Düşük kaliteli trafik** – Tek tıklama, 3 sn'de çıkış; gerçek niyet yok.
3. **Bizim sayım** – Event/call pipeline tutarlı ama müşteri "arama"yı sadece onaylanmış (confirmed) call olarak sayıyordur; intent = tıklama, arama değil.

## Ne yapılır?

### 1) Şüpheli intent'leri listele (Eslamed)

Supabase SQL Editor'da çalıştır:

**`docs/runbooks/oci_eslamed_kuyruk_saldiri_supheli.sql`**

- Son 7 gün kuyruktaki (status = intent) tüm intent'ler gelir.
- Her satırda:
  - **flag_3sn_alti_kalis** – Sitede 3 sn'den az kalmış
  - **flag_tek_etkilesim** – Tek event (sadece tıklama)
  - **flag_proxy** – Proxy/VPN
  - **flag_ayni_fp_cok_intent** – Aynı fingerprint'ten 3'ten fazla intent
  - **flag_ayni_ip_cok_intent** – Aynı IP'den 5'ten fazla intent
  - **suspekt** – Yukarıdakilerden en az biri true ise true

**suspekt = true** olanlar saldırı/sahte adayı; müşteriyle "bunlar gerçek değil" diyerek junk'layabilir veya toplu junk script'i yazılabilir.

### 2) Dashboard'da zaten var: High Risk

Intent kartlarında **High Risk** ve **risk_reasons** (3sn altı kalış, düşük etkileşim, Click ID yok, Organic) zaten gösteriliyor. Müşteri bu kartları junk'layarak kuyruğu temizleyebilir.

### 3) Önlemler (saldırı devam ederse)

- **Fraud quarantine**: Aynı fingerprint çok yüksek frekansta event atıyorsa (env: `OPSMANTIK_FRAUD_FP_THRESHOLD`, `OPSMANTIK_FRAUD_WINDOW_SEC`) event'ler quarantine'e alınıyor; intent oluşmaz.
- **Traffic debloat**: Site'ta bot/referrer gate açıksa şüpheli UA/referrer elenir.
- **Rate limit / geo**: Edge'de istenirse rate limit veya bölge kısıtı sıkılaştırılabilir.

### 4) Intent vs arama netliği

- **Intent** = tel/WhatsApp'a tıklama (calls tablosunda bir satır; status = intent).
- **Arama** = Müşterinin "gerçek arama" dediği şey genelde **confirmed/qualified/real** call veya gerçek santralden gelen çağrı.
- Kuyrukta "onca data" = çok intent. Bunların hepsi gerçek aramaya dönüşmez; özellikle şüpheli olanları junk'lamak kuyruğu gerçeğe yaklaştırır.

## Çöpe gönderilen intent'ler tekrar geliyorsa

- **Neden:** RPC `get_recent_intents_v2` eskiden `status IN ('intent','confirmed','junk')` döndürüyordu; junk yapılan kayıtlar da listede kalıyordu. Migration `20261002000000_get_recent_intents_v2_exclude_junk.sql` ile v2 artık **junk ve cancelled döndürmüyor**; çöplenen kartlar listede görünmez.
- **Kuyruk listesi** `get_recent_intents_lite_v1` kullanıyor. Migration **`20261002000001_junk_stays_and_session_hidden.sql`** şart: aynı session'da herhangi bir call junk/cancelled ise o session kuyrukta gizlenir; uygulanmazsa "çöp geri geliyor" hissi olur. Doğrulama: `JUNK_FLOW_TEST_SITE_ID` veya `STRICT_INGEST_TEST_SITE_ID` ile `npm run test:integration` → `junk-stays-hidden-queue.test.ts`.
- **Aynı session iki kez görünüyorsa:** Migration 20261002000001 uygulandıysa session zaten gizlenir. Uygulanmadıysa: aynı `matched_session_id` için birden fazla call satırı (farklı `intent_stamp`) olabilir; birini junk'layınca diğeri kalır. Supabase'te: `SELECT matched_session_id, COUNT(*), array_agg(id) FROM calls WHERE site_id = '...' AND source = 'click' AND (status = 'intent' OR status IS NULL) GROUP BY matched_session_id HAVING COUNT(*) > 1` ile çiftleri bulup ikincisini de junk'layabilirsiniz.

## Özet

| Adım | Ne yap |
|------|--------|
| Şüpheli listesi | `oci_eslamed_kuyruk_saldiri_supheli.sql` çalıştır, suspekt = true olanları incele/junk'la |
| Dashboard | High Risk intent'leri junk'la |
| Çöp geri geliyor | Migration `20261002000000` ve `20261002000001_junk_stays_and_session_hidden.sql` uygulandı mı kontrol et; test: `npm run test:integration` (junk-stays-hidden-queue). Aynı session iki satır varsa yukarıdaki sorgu ile bulun |
| Devam eden saldırı | Fraud threshold'u düşür, traffic debloat/bot gate kontrol et |
