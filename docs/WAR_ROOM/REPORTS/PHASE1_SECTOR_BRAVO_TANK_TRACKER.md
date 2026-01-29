# SECTOR BRAVO — Tank Tracker (Store & Forward)

**Mission:** ux-core.js refactor — Store-and-Forward (Kaydet ve İlet).  
**Date:** 2026-01-29  
**Status:** Deployed. Test checklist below.

---

## Değişiklikler

- **Eski:** `queueEvent` / `drainQueue` + `sendBeacon` (yanıt okunmuyor) + fetch fallback.
- **Yeni:** `addToOutbox` + `processOutbox` (fetch + response.ok, FIFO, 5s timeout, 5s retry backoff, 10+ attempts + 24h → drop). Kuyruk: `opsmantik_outbox_v2`, envelope: `id`, `ts`, `payload`, `attempts`. Max 100 item, trim to 80.
- **Last Gasp:** `beforeunload` → kuyruğun ilk öğesini `sendBeacon` ile dene (yanıt okunmaz; tekrar ziyarette processOutbox dener).
- **Init:** Sayfa yüklenince + `online` event’te `processOutbox()`.

---

## Test checklist

1. **F12** → Console + Network.
2. **Network** sekmesinde **Offline** yap.
3. Sitede bir butona tıkla (event oluşsun).
4. Console’da `[TankTracker] Network Fail - Retrying later:` görünmeli.
5. **Application** → **Local Storage** → `opsmantik_outbox_v2` → veri görünmeli (Store başarılı).
6. Network’ü tekrar **Online** yap.
7. ~5 saniye bekle → veri gidip Local Storage’dan silinmeli (Forward başarılı).

Bu test geçerse Tank Tracker devrede demektir. SECTOR BRAVO kapatılır.
