# Eslamed OCI Quantum Script — Analiz Raporu

**Tarih:** 01.03.2026  
**Konu:** "Yuklendi: 2" ama Google Ads'te Başarılı: 0 — Neden log/rapor gelmiyor?

---

## 1. Özet Bulgu

| Beklenti | Gerçek | Sebep |
|----------|--------|-------|
| Script "2 yüklendi" diyor | ✓ Doğru | Script 2 satırı `upload.append()` ile ekledi, `apply()` exception atmadı |
| Google "Başarılı: 2" dönsün | ✗ Yok | `upload.apply()` **void** döner — Google hiçbir sonuç vermez |
| Hata varsa log gelsin | ✗ Yok | Google Ads Scripts `apply()` hata döndürmez; sadece exception atar veya susar |
| ACK geri dönüşü loglansın | ⚠ Kısmen | ACK response logu eklendi (güncel script); Google Ads'te çalışan eski sürüm olabilir |

---

## 2. Script Akışı ve Gözlemlenebilirlik Eksikleri

```
1. verifyHandshake()     → session_token alınır        [LOG: ✓]
2. fetchConversions()    → API'den JSON alınır         [LOG: ✓ ham sinyal sayısı]
3. Validator.analyze()   → Satırlar valide edilir      [LOG: ✓ Validation Fail sayısı]
4. upload.append()       → Geçerli satırlar eklenir    [LOG: ✓ Yuklendi sayısı]
5. upload.apply()        → Google'a gönderilir         [LOG: ✗ YOK — void döner]
6. sendAck()             → Backend COMPLETED yapar     [LOG: ✓ ACK response (yeni)]
```

### Kritik: `upload.apply()` Ne Döner?

Google Ads Scripts dokümantasyonu:
> **apply()** — Uploads the file and applies the changes. **Returns nothing (void).**

Yani:
- Google kaç satır kabul etti → bilinmez
- Google kaç satır reddetti → bilinmez
- Partial failure mesajları → script'e gelmez
- Sadece **exception** atarsa yakalayabiliriz

---

## 3. "Başarılı: 0" Ekranı Neden Yanıltıcı?

Gördüğünüz **Değişiklik / Başarılı / Hata** ekranı:
- **Hesap değişiklik geçmişi** (Change History)
- Kampanya, reklam, teklif düzenlemelerini gösterir
- **Offline conversion bulk upload** burada sayılmaz

OCI sonuçları farklı yerlerde:
- **Araçlar → Ölçüm → Dönüşümler** → Conversion action detayı
- **Raporlar** → Dönüşüm sütunları (birkaç saat gecikmeli)
- **Offline Data Diagnostics** (API üzerinden)

---

## 4. Eksik Olan Log/Rapor Noktaları

| # | Eksik | Sprint Önerisi |
|---|-------|----------------|
| 1 | `upload.apply()` sonucu | Google API'den gelmiyor; Scripts'te mümkün değil |
| 2 | Gönderilen satır detayı (orderId, gclid) | Her satır veya özet loglanmalı |
| 3 | ACK response | Eklendi; Google Ads'te script güncel mi kontrol et |
| 4 | Sonuç özet raporu | main() sonunda tek blok halinde özet |
| 5 | Google partial failure | Scripts ile alınamaz; API gerekir |

---

## 5. Önerilen Script İyileştirmeleri (Sprint)

1. **Sonuç özet raporu** — main() sonunda:
   ```
   === RAPOR ===
   Ham sinyal: X | Yüklendi: Y | Skip: Z | Validation Fail: W
   Google'a giden ID'ler: seal_xxx, seal_yyy
   ACK: ok=true, updated=2
   ============
   ```

2. **Her gönderilen satır için kısa log** (en az orderId + gclid özet):
   ```
   [GONDERILDI] orderId=xxx... gclid=yyy... conversionTime=...
   ```

3. **Google Ads Script güncellemesi** — ACK response logu var; Google Ads Editor'daki scripti repo ile senkronize et.

4. **upload.apply() try-catch** — Zaten var; exception olursa `onUploadFailure` tetikleniyor. Ek: exception mesajını tam logla (500 karakter).

5. **Opsiyonel: Google Ads API** — Offline conversion upload summaries için ayrı bir backend job (Scripts dışı).

---

## 6. Mevcut Log Çıktısı vs Beklenen

### Şu an (19:48 örneği):
```
[INFO] 2 ham sinyal yakalandi. Validasyon basliyor...
[INFO] Yukleme Bilancosu: Yuklendi: 2, Deterministic Skip: 0, Validation Fail: 0
[INFO] 2 kayit icin API'ye Muhur (ACK) gonderiliyor...
[INFO] Eslamed OCI senkronizasyonu tamamlandi.
```

### ACK logu neden yok?
- Güncel repodaki script `ackRes` logluyor
- Google Ads'te çalışan script **eski sürüm** olabilir — Script Editor'a yapıştırılan kod güncel değil

### Google "Başarılı: 0" neden?
- O ekran OCI bulk upload sonucu değil
- OCI sonuçları dönüşüm raporlarında görünür (3+ saat gecikme olabilir)

---

## 7. Sprint Checklist

- [ ] Script'i Google Ads Editor'da repo ile güncelle (ACK log dahil)
- [ ] Sonuç özet raporu ekle (=== RAPOR === bloğu)
- [ ] Her satır için `[GONDERILDI]` log (orderId, gclid kısaltılmış)
- [ ] upload.apply() exception mesajını tam logla
- [ ] Doc: Google Ads'te OCI sonuçlarının nerede görüldüğü (Türkçe yol)
