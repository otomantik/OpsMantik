# Muratcan 7 Dönüşüm — Gidecek Format + Gelişmiş Dönüşüm (Hashed Phone) Analizi

## GCLID “kayboldu” mu? — Derin analiz özeti

**Kısa cevap: Hayır. GCLID kuyrukta ve session’da duruyor (6/7 satır).** “Glic yok” hissi, Google’ın **INVALID_CLICK_ID_FORMAT** döndürmesinden kaynaklanıyor: istek gidiyor ama API kabul etmiyor.

| Kontrol | Sonuç |
|--------|--------|
| Kuyrukta GCLID dolu | **6 satır** — GCLID kaybolmamış |
| Sadece gbraid (GCLID yok) | **1 satır** (queue_id 12d75067…) — session’da da gclid yok |
| Session’da GCLID (kaynak) | 6 satırda hem kuyruk hem session’da var |
| Son başarılı (COMPLETED) | Muratcan için DB’de **yok** (eski kayıtlar silinmiş veya hiç başarılı gönderim olmamış) |
| FAILED ne zaman işaretlendi | Hepsi **2026-03-03 15:06** — tek worker çalışmasında toplu red |
| Oluşturulma tarihleri | 28 Şubat, 1 Mart, 2 Mart, 3 Mart 2026 |

**“Eskiden gönderiyorduk” yorumu:**  
- Ya bu 7 satır hiç başarıyla gitmedi (ilk gönderimde toplu red).  
- Ya da önceden sadece **gclid** gönderiliyordu; kuyruğa **gbraid** de yazılmaya başlayınca API aynı conversion’da hem gclid hem gbraid görünce **INVALID_CLICK_ID_FORMAT** veriyor.  

**Yapılacak:** Sadece **gclid** bırakıp (gbraid/wbraid temizle) FAILED→QUEUED yapıp worker’ı çalıştırmak. GCLID’siz 1 satır için backfill/bridge veya gbraid’i kabul eden hesap ayarı.

Derin analiz scripti (tarihler + session/kuyruk karşılaştırması):  
`node scripts/db/oci-muratcan-derin-analiz.mjs`

**FAILED nedeni: MAX_ATTEMPTS_EXCEEDED**  
Script export her claim'de `attempt_count` artar. Cron `attempt-cap` (MAX_ATTEMPTS=5) `attempt_count >= 5` olan satırları FAILED yapar (`provider_error_code: MAX_ATTEMPTS`). Yani satır 5 kez export edilip ack/COMPLETED olmamış (script hata vermiş, ack gitmemiş veya Google reddetmiş). Tekrar denemek için: `node scripts/db/oci-requeue-all-failed.mjs` ile QUEUED yapılır (attempt_count sıfırlanmaz ama status QUEUED olunca script tekrar alabilir; attempt_count RPC'de sadece claim'de artar, requeue sadece status değiştirir).

---

## Şu an hangi aşamadayız?

| Aşama | Durum | Açıklama |
|-------|--------|----------|
| Kuyrukta 7 satır | ✅ | Hepsi FAILED, INVALID_CLICK_ID_FORMAT |
| Format düzeltmesi (sadece gclid) | ✅ Script hazır | Hem gclid hem gbraid olanlarda wbraid/gbraid temizlenir |
| GCLID'siz 1 satır | ⚠️ Backfill/Bridge | Session'dan gclid veya GCLID bridge; telefon hash tek başına click conversion için yeterli değil |
| FAILED → QUEUED | ✅ Script hazır | 7 satır tekrar kuyruğa alınır |
| Gelişmiş dönüşüm (hashed phone) | ✅ Pipeline eklendi | Call'da `caller_phone_hash_sha256` varsa API'ye `user_identifiers` ile gider |

---

## Muratcan gidecek dönüşümler — Şema ve özet

Worker claim edip Google’a tek istekte `uploadClickConversions` ile gönderir. Her dönüşüm aşağıdaki şemada tek öğe olur.

### Google API şeması (conversions[] öğesi)

```
ClickConversionRequest (tek dönüşüm):
├── conversion_action       string   (customers/{customerId}/conversionActions/{id})
├── conversion_date_time    string   "yyyy-mm-dd hh:mm:ss+00:00" (UTC)
├── conversion_value        number   major birim (örn. 1500 = 1500 TRY)
├── currency_code           string   "TRY" | "USD" | ...
├── order_id                string   deterministik, tekilleştirme (max 128 char)
├── gclid | wbraid | gbraid string   tam biri zorunlu (base64 normalize)
└── user_identifiers?       array    Enhanced Conversions (opsiyonel)
    └── [ { hashed_phone_number: string } ]  64 char hex SHA-256
```

### Muratcan 7 satır — ne gidecek

| # | queue_id (kısa) | conversion_date_time | conversion_value | click_id | Enhanced (hashed_phone) |
|---|-----------------|----------------------|------------------|----------|-------------------------|
| 1 | 7e6e1bcc | 2026-02-28 11:12:10+00:00 | 1 500 TRY | gclid | Hayır |
| 2 | 0b975974 | 2026-02-28 20:49:15+00:00 | 1 700 TRY | gclid | Hayır |
| 3 | 36bbb2db | 2026-03-01 19:23:13+00:00 | 2 000 TRY | gclid | Hayır |
| 4 | 7c418b4f | 2026-03-02 14:51:40+00:00 | 1 300 TRY | gclid | Hayır |
| 5 | 12d75067 | 2026-03-03 05:56:16+00:00 | 1 500 TRY | **gbraid** | **Evet** (16d16455...) |
| 6 | 79e3699c | 2026-02-28 20:49:40+00:00 | 2 000 TRY | gclid | Hayır |
| 7 | 273a91ec | 2026-02-28 11:12:41+00:00 | 20 000 TRY | gclid | Hayır |

**Özet:** 7 dönüşüm → 6’sı sadece **gclid**, 1’i (12d75067) **gbraid + hashed_phone**. Toplam değer 29 000 TRY.  
**Not:** 5. satır gbraid ile gidiyor; hesap gbraid kabul etmiyorsa Google yine INVALID_CLICK_ID_FORMAT dönebilir. Diğer 6 satır sadece gclid ile gönderildiği için kabul şansı yüksek.

Önizleme (güncel kuyruk): `node scripts/db/oci-google-payload-preview.mjs Muratcan`

---

## 1. Bu 7 dönüşümü “istenen conversation formatında” gönderebiliyor muyuz?

**Evet**, şu an:

- **6 satır:** GCLID var → Sadece gclid bırakıp QUEUED yapınca **click conversion** olarak gider. Üstelik call’da **caller_phone_hash_sha256** (mühür sırasında operatör telefonu + hash) varsa, runner bu hash’i job payload’a ekliyor; mapper da **user_identifiers: [{ hashed_phone_number }]** ile Google’a gönderiyor. Yani **Enhanced Conversions** formatında (gclid + hashed phone) gidebiliyoruz.

- **1 satır (queue_id 12d75067…):** Kuyrukta **GCLID yok**, sadece gbraid var. Google bu hesapta gbraid’i reddediyor (INVALID_CLICK_ID_FORMAT).  
  - **uploadClickConversions** için Google’da **en az bir click ID (gclid / wbraid / gbraid) zorunlu**. Sadece hashed_phone ile click conversion gönderilemez.  
  - Bu satırı “conversation formatında” (Enhanced) göndermek için **önce bir click ID** gerekir: session’dan **gclid backfill** veya **GCLID bridge** (aynı fingerprint, son 14 gün, GCLID’li session).  
  - Call’da **telefon varsa** (caller_phone_e164 + caller_phone_hash_sha256), gclid bulunduktan sonra aynı satır **gclid + hashed_phone** ile Enhanced olarak gider.

Özet: 6’sı zaten “conversation formatına” (gclid + isteğe bağlı hashed phone) uygun; 1’i için önce gclid bulunmalı, sonra yine aynı formatta gidebilir.

---

## 2. Telefon hash’i nereden geliyor, nasıl gidiyor?

- **Kaynak:** Mühür (seal) sırasında operatör **caller_phone** girerse, `app/api/calls/[id]/seal/route.ts` E.164 normalize edip `hashPhoneForEC(phone, salt)` ile **caller_phone_hash_sha256** (64 karakter hex) hesaplıyor ve `calls` tablosuna yazıyor.  
- **Kuyruk:** Kuyruk satırında hashed_phone kolonu yok; **runner** claim sonrası her satırın **call_id**’si ile `calls`’tan **caller_phone_hash_sha256** çekip ilgili job’un **payload.hashed_phone_number** alanına yazıyor.  
- **Google:** Mapper, `payload.hashed_phone_number` varsa (64 char hex) **user_identifiers: [{ hashed_phone_number }]** ekliyor; adapter aynen API’ye iletiyor.  
- **Salt:** `OCI_PHONE_HASH_SALT` (veya seal’da kullanılan salt) ile hash üretiliyor; Google’ın beklediği normalizasyon (E.164, digits-only, sonra SHA-256) ile uyumlu.

Yani **telefon hash’le göndermek** için: call’da **caller_phone_hash_sha256** dolu olmalı (mühürde telefon girilmiş olmalı). Bu 7 dönüşümde hangi call’larda telefon var, rapor/script ile kontrol edilebilir.

---

## 3. Yapılacaklar (sırayla)

1. **Tek seferde format + QUEUED:**  
   `node scripts/db/oci-muratcan-7-fix-and-requeue.mjs`  
   - Hem gclid hem gbraid/wbraid olanlarda sadece gclid kalır.  
   - GCLID’siz 1 satırda session’dan gclid backfill dener.  
   - 7 satırın hepsi QUEUED + next_retry_at geçmişe alınır.

2. **Worker/cron çalıştır:**  
   Process-offline-conversions cron veya google-ads-oci worker tetiklenince 7 satır claim edilip Google’a gider. Call’da **caller_phone_hash_sha256** olanlar **user_identifiers** ile (Enhanced) gider.

3. **GCLID’siz 1 satır hâlâ FAILED ise:**  
   - `node scripts/db/oci-muratcan-backfill-gclid-from-session.mjs` (session’da gclid varsa yazar).  
   - Veya `node scripts/db/oci-muratcan-gclid-bridge.mjs` (aynı fingerprint, son 14 gün, GCLID’li session’dan gclid alır).  
   Sonra tekrar QUEUED yapıp worker’ı çalıştırın.

4. **Telefon/hash kontrolü (isteğe bağlı):**  
   7 call’da hangilerinde `caller_phone_hash_sha256` dolu, SQL veya script ile bakılabilir; böylece hangi dönüşümlerin Enhanced olarak gideceği görülür.

---

## 4. Özet tablo

| Konu | Durum |
|------|--------|
| Kuyrukta sadece gidecek format (sadece gclid) | `oci-muratcan-7-fix-and-requeue.mjs` |
| 7 satırı QUEUED yapma | Aynı script |
| GCLID’siz 1 satır | Backfill veya bridge; sonra yine gclid + isteğe bağlı hashed_phone |
| Hashed phone ile gönderim | Runner + mapper + types eklendi; call’da hash varsa otomatik gider |
| Conversation / Enhanced format | 6 satır zaten uygun; 1 satır gclid bulununca uyumlu olur |

Bu ayarlarla kuyruktakiler sadece gidecek formatta olur ve telefon hash’i olanlar istenen “conversation” (Enhanced) formatında gönderilir.
