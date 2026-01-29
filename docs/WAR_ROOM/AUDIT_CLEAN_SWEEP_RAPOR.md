# Müfettiş Raporu — Kirli Kod Avcısı Sonucu

**Komut:** `npm run audit:codebase` (veya `node scripts/audit-codebase.mjs`)

---

## Özet

| Kategori | Sayı | Vahamet |
|----------|------|--------|
| **Hardcoded secret** | 0 | ✅ Temiz |
| **Spaghetti (400+ satır)** | 12 dosya | 🟡 Orta — bölünebilir |
| **console.log** | ~582 | 🟠 Yüksek — prod öncesi temizlenmeli |
| **Türkçe karakter** | ~153 | 🟢 Çoğu UI metni — i18n’e taşınacak |

---

## 1) Hardcoded secret

**Sonuç: (none)**  
Kodda `sk-proj-...` veya `eyJ...` gibi sabit secret yok. Secret’lar env’den okunuyor.

---

## 2) Spaghetti (400+ satır)

Bölünmesi mantıklı dosyalar:

| Dosya | Satır | Öneri |
|-------|--------|--------|
| `app/api/sync/route.ts` | 889 | Sync mantığını modüllere böl (validate, insert, match) |
| `app/test-page/page.tsx` | 830 | Test sayfası — bileşenlere böl |
| `components/dashboard/session-group.tsx` | 967 | En büyük — alt bileşenlere böl |
| `components/dashboard/live-inbox.tsx` | 877 | Queue / card ayrı dosya |
| `components/dashboard-v2/QualificationQueue.tsx` | 665 | Fetch / card / history ayrılabilir |
| `lib/hooks/use-realtime-dashboard.ts` | 624 | Realtime / stats ayrılabilir |
| `components/dashboard-v2/HunterCard.tsx` | 446 | Kabul edilebilir; gerekirse Intel/Evidence ayrılır |
| Diğerleri | 436–585 | İhtiyaç halinde böl |

---

## 3) console.log (~582 adet)

- **app/api/sync/route.ts** — Çok sayıda log; prod’da kaldırılmalı veya `NEXT_PUBLIC_WARROOM_DEBUG` ile sarılmalı.
- **app/api/call-event/route.ts** — Az sayıda; aynı şekilde.
- Diğer **app/** ve **components/** — Debug log’ları kaldır veya `process.env.NODE_ENV === 'development'` ile sar.

**Öneri:**  
- Prod’da log istemiyorsan: `console.log` satırlarını kaldır veya `logger.debug()` gibi bir wrapper’a taşı (dev’de açık, prod’da kapalı).

---

## 4) Türkçe karakter (~153)

- **app/test-page/page.tsx** — Test sayfası UI metinleri (örn. "Gönder", "Hemen Başla", "Broşür İndir"). Sonra i18n JSON’a taşınabilir.
- **components/** — "AI Özet", "Mission Accomplished", buton metinleri vb. UI metinleri; i18n’e taşınacak.
- **Yorum / string dışı** Türkçe (değişken/fonksiyon adı) varsa İngilizce’ye çevir.

**Öneri:**  
- Önce **logic** dosyalarında (lib, api) Türkçe değişken/ fonksiyon adı var mı kontrol et; varsa İngilizce yap.  
- UI metinlerini sonra tek bir i18n dosyasına (örn. `messages/tr.json`) taşı.

---

## Savaş emri (öncelik)

1. **Secret:** Zaten temiz; bir şey yapma.
2. **console.log:** API route’ları (özellikle `sync/route.ts`) ve `call-event/route.ts` içindeki log’ları kaldır veya `NODE_ENV === 'development'` ile sar.
3. **Spaghetti:** Önce `app/api/sync/route.ts` ve `session-group.tsx` / `live-inbox.tsx` bölünmesi en çok faydayı sağlar.
4. **Türkçe:** Önce lib/app’te Türkçe **identifier** varsa İngilizce’ye çevir; UI metinlerini i18n’e taşıma sonraki adım.

---

## Tekrar çalıştırma

```bash
npm run audit:codebase
```

Temizlik sonrası raporu tekrar çalıştırıp sayıları kontrol et.

---

## Yapılan temizlikler (2026-01-29)

1. **console.log / console.warn**
   - `lib/utils.ts`: `debugLog`, `debugWarn` eklendi (sadece dev veya `NEXT_PUBLIC_WARROOM_DEBUG` açıkken loglar).
   - `app/api/sync/route.ts`: Tüm `console.log` → `debugLog`, `console.warn` → `debugWarn`; `console.error` prod izleme için bırakıldı.
   - `app/api/call-event/route.ts`: Aynı şekilde log/warn sarıldı.

2. **Türkçe identifier**
   - lib/app içinde Türkçe **değişken veya fonksiyon adı** yok. Sadece UI etiketleri (örn. `Bugün`, `Dün`) var; rapor i18n’e taşınmasını sonraki adım olarak öneriyor.

3. **Spaghetti (sync route)**
   - `lib/sync-utils.ts` eklendi: `getRecentMonths`, `createSyncResponse` buraya taşındı.
   - `app/api/sync/route.ts` ve `app/api/call-event/route.ts` bu modülü kullanıyor; route dosyası ~45 satır kısaldı, tekrarlayan `getRecentMonths` kaldırıldı.
