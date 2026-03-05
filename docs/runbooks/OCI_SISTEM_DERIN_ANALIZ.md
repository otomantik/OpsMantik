# OCI Sistem — Derin Analiz (5 Set, Çöp Kitle, İki Başlılık)

**Tarih:** 2026-03-05  
**Amaç:** 5 dönüşüm seti tek akışta; çöp ayrı kitle (yarın dışlama); iki başlılık ve takılma noktalarının net resmi.

---

## 1. Beş dönüşüm seti — nerede yaşıyor, nasıl Google’a gidiyor

| Set | Google Ads adı | Depo | Oluşma yeri | Export’ta kaynak | Ack sonrası |
|-----|------------------|------|--------------|-------------------|-------------|
| **V1** | OpsMantik_V1_Nabiz | **Redis** (`pv:queue`, `pv:data`) | POST /api/track/pv → V1PageViewGear | Redis’ten LMOVE + %10 sample | pv_* → Redis DEL + LREM |
| **V2** | OpsMantik_V2_Ilk_Temas | **marketing_signals** | process-call-event (call oluşunca) + process-sync-event (sync intent, düzeltme ile) | dispatch_status=PENDING | signal_* → SENT |
| **V3** | OpsMantik_V3_Nitelikli_Gorusme | **marketing_signals** | Seal lead_score=60, outbox cron | dispatch_status=PENDING | signal_* → SENT |
| **V4** | OpsMantik_V4_Sicak_Teklif | **marketing_signals** | Seal lead_score=80, outbox cron | dispatch_status=PENDING | signal_* → SENT |
| **V5** | OpsMantik_V5_DEMIR_MUHUR | **offline_conversion_queue** | Seal → enqueue-seal-conversion / seal route | status IN (QUEUED, RETRY) | seal_* → UPLOADED |

Özet: **Üç depo** var — Redis (V1), marketing_signals (V2–V4), offline_conversion_queue (V5). Export üçünü birleştirip tek JSON’da döner; script hepsini aynı CSV ile yükler; ack prefix’e göre (pv_ / signal_ / seal_) ilgili depoyu günceller.

---

## 2. İki başlılık (çift yol) — intent vs kuyruk

### 2.1 Call “intent” kuyruğa girmiyor

- **intent** = call status (operatör henüz mühürlemedi).
- **Kuyruk** (offline_conversion_queue) = sadece **V5**; satır **sadece seal** sonrası eklenir (enqueue-seal-conversion veya seal route).
- Yani: 44 “intent” call’ın kuyrukta karşılığı yok; doğru davranış bu. Intent’ler **V2** ile Google’a gider (marketing_signals’ta PENDING → export → script → ack → SENT).

Karışıklık: “Intent’ler kuyrukta yok” denince sanki eksikmiş gibi algılanıyor; aslında intent’ler **nabız (V2)** tarafında, kuyruk sadece mühür (V5).

### 2.2 İki giriş yolu: sync vs call-event

- **Sync/ingest:** Event → process-sync-event → IntentService.handleIntent → ensure_session_intent_v1 → call (status=intent). V2 artık burada da tetikleniyor (process-sync-event’te handleIntent sonrası V2_PULSE).
- **Call-event API:** POST /api/call-event (veya v2) → process-call-event → call insert → V2_PULSE.

Aynı “intent” iki farklı yerden oluşabiliyor; V2 her iki yolda da yazılıyor (sync tarafı yeni eklendi).

### 2.3 İki “PROCESSING” — aynı isim, farklı tablo

- **offline_conversion_queue.status = 'PROCESSING'**  
  Export claim edince olur; ack gelince UPLOADED. Ack gelmezse takılır.
- **marketing_signals.dispatch_status = 'PROCESSING'**  
  Export dönerken PENDING → PROCESSING yapılır; ack gelince SENT. **Düzeltme:** Ack artık PROCESSING’i arıyor (önceden PENDING aranıyordu, nabız hiç SENT olmuyordu).

---

## 3. Akış tek çizelge — export → script → ack

```
[Export GET markAsExported=true]
  → Kuyruk: QUEUED/RETRY satırları seçilir, claim RPC → PROCESSING.
  → Sinyaller: PENDING seçilir, aynı response’ta id’lerle dönülür, UPDATE → PROCESSING.
  → V1: Redis’ten pv:queue → pv:processing’e LMOVE.
  → Response: items = [seal_*, signal_*, pv_*] (combined, sorted by time).

[Script]
  → items’ı CSV’ye yazar, Google’a yükler.
  → Başarılı id’ler için POST /api/oci/ack (queueIds: [seal_*, signal_*, pv_*]).
  → Hata için POST /api/oci/ack-failed (fatalErrorIds).

[Ack]
  → seal_* → offline_conversion_queue: PROCESSING → UPLOADED.
  → signal_* → marketing_signals: PROCESSING → SENT (önceden PENDING idi, düzeltildi).
  → pv_* → Redis DEL pv:data, LREM pv:processing.
```

Takılma: Export 200, script upload yaptı, ack 404/401 → kuyruk satırı PROCESSING’de kalır, sinyal PROCESSING’de kalır. Script tarafında ack response kontrolü eklendi; manuel ack (curl) veya Dashboard’dan Reset to Queued ile açılabilir.

---

## 4. Çöp (junk) — nerede, kitle nasıl kullanılır

- **Kayıt:** `calls.status = 'junk'` (apply_call_action_v1, action_type=junk). call_actions’a audit yazılır.
- **Kuyrukta görünmez:** get_recent_intents_v2 / get_recent_intents_lite session’da herhangi junk/cancelled varsa o session’ı döndürmüyor; yani operatör kuyrukta “junk” satırı görmez.
- **Queue’da satır:** Eğer call önce kuyruğa alınmış (seal) sonra junk yapılmışsa, offline_conversion_queue’da o call_id’li satır hâlâ duruyor olabilir (status QUEUED/PROCESSING/FAILED vb.). Junk yapıldığında kuyruk satırı otomatik silinmiyor veya “junk” diye işaretlenmiyor.

**5 set + çöp kitle hedefi:**

- **5 set:** V1–V5 zaten export’ta birlikte gidiyor; script tek CSV ile hepsini yüklüyor.
- **Çöp kitle (dışlama):** Google’da “junk” kitle oluşturmak için junk call’ları (veya ilgili gclid/wbraid/gbraid) bir conversion veya audience olarak göndermek gerekir. Şu an OCI tarafında junk’ı ayrı bir conversion/audience olarak export eden bir yol yok. Seçenekler:
  - **A)** Ayrı bir conversion action “OpsMantik_Junk” (value=0) tanımlayıp, junk yapılan call’ların click_id’lerini periyodik veya anlık bu conversion ile yüklemek; sonra bu conversion’ı “audience exclusion” veya “custom audience” olarak kullanmak.
  - **B)** Mevcut 5 set’i kullanıp, junk’ı sadece dashboard/rapor tarafında tutmak; Google kitle dışlaması için başka bir mekanizma (ör. offline/job’la “junk” listesi göndermek) tasarlamak.

Yarın/öbür gün “kitle dışlama” için: Hangi kitleyi dışlayacağınız netleşmeli (örn. “Bu gclid’ler junk, bu kullanıcıları kampanyadan çıkar”). O zaman (A) veya (B) için net gereksinim yazılıp uygulanabilir.

---

## 5. Tespit edilen hata (düzeltildi)

- **Ack – nabız (signal_*):** Export marketing_signals satırlarını dönerken **PROCESSING** yapıyordu; ack ise **PENDING** olanları SENT yapıyordu. Sonuç: Nabız hiç SENT olmuyordu, hep PROCESSING’de kalıyordu.
- **Düzeltme:** `app/api/oci/ack/route.ts` içinde signal güncellemesi `dispatch_status = 'PROCESSING'` ile yapılıyor.
- **ack-failed:** Sinyal FAILED güncellemesi `PENDING` veya `PROCESSING` olanlara uygulanacak şekilde `in('dispatch_status', ['PENDING', 'PROCESSING'])` yapıldı.

---

## 6. Özet tablo — tek bakışta

| Konu | Durum |
|------|--------|
| 5 set aynı anda gönderiliyor mu? | Evet. Export kuyruk + marketing_signals + Redis PV’yi birleştirir; script tek CSV ile yükler. |
| Intent kuyrukta mı? | Hayır. Intent = call; kuyruk = V5 (sadece seal). Intent → V2 (marketing_signals). |
| İki başlılık var mı? | Var: (1) İki intent girişi (sync vs call-event), (2) İki depo (queue vs signals), (3) Aynı isimle iki PROCESSING (queue vs signals). Akış tek (export→script→ack) ama depo ve prefix’ler ayrı. |
| Takılma (PROCESSING)? | Kuyruk: ack 404 → PROCESSING’de kalır. Sinyal: aynı mantık; artık ack PROCESSING’i güncelliyor, yeni takılma azalır. |
| Çöp kitle? | Junk DB’de (calls.status); kuyruk görünümünden gizli. Google’da “çöp kitle” için ayrı conversion/audience akışı henüz yok; tasarım için (A)/(B) seçeneği yukarıda. |

Bu doküman mevcut kodu ve düzeltmeleri yansıtır; klişe veya varsayıma dayanmaz.
