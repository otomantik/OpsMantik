# OCI: GCLID Nereden Geliyor, Neden Bazen Session'da Yok?

## Kısa cevap

- **Evet, dönüşümleri gönderiyoruz** — kuyruğa alınıp API'ye istek gidiyor.
- **Şu an gördüğünüz sorun:** Google `INVALID_CLICK_ID_FORMAT` dönüyor; yani istek gidiyor ama **kabul edilmiyor**. Bu, “GCLID hiç yakalanmıyor” demek değil; 7 satırın 6’sında GCLID kuyrukta var, 1’inde sadece gbraid var.
- **GCLID’nin session’da olmaması** ise ayrı bir konu: ilk gelen istekte GCLID yoksa veya trafik “Organic” sayılıyorsa session’a **bilerek** yazılmıyor (ghost attribution engeli). O zaman mühürlense bile kuyruğa gclid’siz düşer, Google’a da gidemez.

---

## GCLID akışı (nereden nereye)

```
[Site: muratcanaku.com]
  → Kullanıcı Google reklamına tıklar, URL’de ?gclid=... (veya wbraid/gbraid) olur
  → OpsMantik script sayfada gclid’i okuyup /api/sync veya /api/call-event/v2’ye ekler

[Sync / Ingest]
  → Session oluşturulur veya güncellenir
  → GCLID sadece “Organic değilse” session’a yazılır (aşağıda)

[Session]
  → sessions.gclid / wbraid / gbraid = ilk (veya son) istekten gelen değerler
  → Organic ise: gclid/wbraid/gbraid = null (GCLID Phase 2)

[Mühür (Seal)]
  → get_call_session_for_oci(call_id) → session’daki gclid/wbraid/gbraid
  → offline_conversion_queue’ya aynen yazılır

[Worker]
  → Kuyruktan okuyup Google’a tek ID (gclid veya wbraid veya gbraid) gönderir
  → Google INVALID_CLICK_ID_FORMAT dönerse → FAILED
```

Yani **GCLID’yi “yakalama”** iki aşamada:

1. **Client:** URL’den gclid’i alıp sync/call-event payload’ına koymak.
2. **Backend:** İlk (veya ilgili) istekte trafik **Organic sayılmıyorsa** bu değeri session’a yazmak.

---

## Session’a neden yazılmıyor? (Organic kuralı)

Kod: `lib/services/session-service.ts` (yeni session oluştururken):

- `attributionSource === 'Organic'` **veya** `traffic_source` = Direct / SEO / Referral ise → **Organic** sayılıyor.
- Organic ise: `gclid`, `wbraid`, `gbraid` **bilerek null** yazılıyor (ghost attribution’ı önlemek için).

Attribution sırası (`lib/attribution.ts`):

1. **GCLID varsa** → "First Click (Paid)" → Organic değil → GCLID session’a yazılır.
2. UTM medium = cpc/ppc/paid → "Paid (UTM)" → yazılır.
3. Referrer + geçmişte GCLID → "Ads Assisted" → yazılır.
4. Bunlar yoksa → **"Organic"** → GCLID yazılmaz.

Yani **ilk gelen istekte gclid yoksa** (URL’de yok veya client göndermiyorsa) session zaten “Organic” kalır ve GCLID hiç persist edilmez. Sonradan aynı session’a gclid’li istek gelse bile, mevcut kuralla Organic session’a click ID eklenmiyor (güvenlik kuralı).

Özet: **GCLID’nin düzgün yakalanması için:**

- Kullanıcı **reklam tıklamasıyla** (URL’de gclid/wbraid/gbraid ile) gelmeli **ve**
- Bu **ilk** sync/call-event isteğinde **gclid (veya wbraid/gbraid) payload’da** olmalı.

---

## “Önceden gidiyordu, şimdi hiç gitmiyor” ne anlama gelebilir?

1. **Hep FAILED (INVALID_CLICK_ID_FORMAT)**  
   İstek gidiyor, GCLID de kuyrukta var; Google format/hesap nedeniyle reddediyor. Bu durumda sorun “yakalama” değil, “Google’ın kabul etmemesi”. Çözüm: sadece gclid gönder, gbraid/wbraid’i kuyrukta temizle; gclid’i olmayan 1 satır için backfill/bridge (runbook’taki adımlar).

2. **Yeni dönüşümler hiç kuyruğa girmiyor (no_click_id)**  
   Yeni mühürlenen aramalarda session’da gclid yok. O zaman ya:
   - Sitede GCLID artık ilk istekte gönderilmiyor (tag/script/SPA), ya da
   - İlk istek Organic sayılıyor (referrer/UTM yok, gclid de yok).

3. **Eski dönüşümler gidiyordu, yeniler gitmiyor**  
   Hesap/format/ID tipi değişikliği (ör. sadece gclid kabul, gbraid kabul etmeme) veya 90 gün kuralı.

---

## Teşhis: GCLID yakalanıyor mu?

Muratcan için:

```bash
# Son 7 gün session’larında GCLID oranı ve attribution dağılımı
node scripts/db/oci-muratcan-gclid-yakalama-teşhis.mjs
```

- Session’da gclid/wbraid/gbraid dolu oranı düşükse → client veya Organic sınıflandırması kontrol edilmeli.
- Kuyrukta FAILED olan satırların session’ında GCLID varsa → sorun büyük ihtimalle Google tarafında (format/hesap/ID tipi); yakalama tarafı çalışıyor demektir.

---

## Ne yapılmalı?

| Durum | Yapılacak |
|-------|------------|
| Kuyrukta GCLID var ama hep INVALID_CLICK_ID_FORMAT | Runbook: sadece gclid bırak, FAILED’ları QUEUED yap, tekrar gönder; gclid’siz 1 satır için backfill/bridge. |
| Yeni mühürlerde sürekli no_click_id | Sitede ilk sayfa/sync isteğinde gclid’in URL’den alınıp gönderildiğini doğrula; Organic’e düşmemesini kontrol et. |
| Session’da GCLID oranı düşük | Tag/script’in ilk yüklemede gclid’i payload’a eklediğini ve sync’in bu istekle session açtığını kontrol et. |

Bu akış ve kurallar Eslamed için de aynıdır; sadece site/domain farklıdır.
