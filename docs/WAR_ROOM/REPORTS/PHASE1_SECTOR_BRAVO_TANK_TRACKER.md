# SECTOR BRAVO — Tank Tracker (Store & Forward)

**Mission:** ux-core.js refactor — Store-and-Forward (Kaydet ve İlet).  
**Date:** 2026-01-29  
**Status:** Deployed. Test checklist + smoke/SQL kanıtı aşağıda.

---

## Değişiklikler

- **Eski:** `queueEvent` / `drainQueue` + `sendBeacon` (yanıt okunmuyor) + fetch fallback.
- **Yeni:** `addToOutbox` + `processOutbox` (fetch + response.ok, FIFO, 5s timeout, 5s retry backoff, 10+ attempts + 24h → drop). Kuyruk: `opsmantik_outbox_v2`, envelope: `id`, `ts`, `payload`, `attempts`. Max 100 item, trim to 80.
- **Last Gasp:** `beforeunload` → kuyruğun ilk öğesini `sendBeacon` ile dene (yanıt okunmaz; tekrar ziyarette processOutbox dener).
- **Init:** Sayfa yüklenince + `online` event’te `processOutbox()`.

---

## Kanıt: Tek komut (sen beklemeden çalışır)

```bash
npm run smoke:tank-tracker-all
```

Statik + Events proof otomatik çalışır; Playwright için `.env.local`'a `TRACKER_SITE_URL` veya `PROOF_URL` ekle. Tekil: `smoke:tank-tracker`, `smoke:tank-tracker-events`, `smoke:tank-tracker-offline`.

---

## Kanıt: Sorgu + Smoke (manuel test gerekmez)

### 1. Statik smoke (ux-core.js’te Tank Tracker var mı?)

```bash
npm run smoke:tank-tracker
```

veya:

```bash
node scripts/smoke/tank-tracker-proof.mjs
```

Başarılıysa: `opsmantik_outbox_v2`, `addToOutbox`, `processOutbox`, `response.ok`, `online` listener, `beforeunload` + `sendBeacon` desenleri mevcut.

### 2. SQL: Veri sunucuya ulaştı mı?

Supabase **SQL Editor**’da çalıştır (test/site kullanımından sonra):

```bash
# Dosya: scripts/smoke/tank-tracker-events-proof.sql
```

İçeriği kopyala-yapıştır veya doğrudan:

```sql
SELECT COUNT(*) AS son_5_dk_event_sayisi,
       COUNT(*) FILTER (WHERE site_id IS NOT NULL) AS site_id_dolu
FROM public.events
WHERE created_at >= NOW() - INTERVAL '5 minutes';

SELECT id, site_id, event_action, event_category, created_at
FROM public.events
ORDER BY created_at DESC
LIMIT 10;
```

Son 5 dakikada event varsa ve `site_id_dolu` > 0 ise veri sunucuya ulaşıyor demektir.

### 3. Playwright: Offline → Online (otomatik)

Tracker yüklü bir sayfa URL’i gerekir (`TRACKER_SITE_URL` veya `PROOF_URL`):

```bash
TRACKER_SITE_URL=https://www.poyrazantika.com npm run smoke:tank-tracker-offline
```

veya:

```bash
TRACKER_SITE_URL=https://www.poyrazantika.com node scripts/smoke/tank-tracker-offline-online.mjs
```

Script: sayfayı açar → offline yapar → event tetikler (reload) → outbox’ta veri var mı bakar → online yapar → 6 sn bekler → outbox boşaldı mı bakar. Başarılıysa Store & Forward kanıtlanır.

---

## Manuel test checklist (isteğe bağlı)

1. **F12** → Console + Network.
2. **Network** sekmesinde **Offline** yap.
3. Sitede bir butona tıkla (event oluşsun).
4. Console’da `[TankTracker] Network Fail - Retrying later:` görünmeli.
5. **Application** → **Local Storage** → `opsmantik_outbox_v2` → veri görünmeli (Store başarılı).
6. Network’ü tekrar **Online** yap.
7. ~5 saniye bekle → veri gidip Local Storage’dan silinmeli (Forward başarılı).

Bu test geçerse Tank Tracker devrede demektir. SECTOR BRAVO kapatılır.

---

## Yerel Tank Tracker kanıtı (canlı site eski tracker kullanıyorsa)

Canlı sitede hâlâ eski tracker varsa veya offline'da kuyruğa yazılmıyorsa, **yerel test sayfası** ile projedeki `public/ux-core.js` (Tank Tracker) test edilir:

1. **`.env.local`** içine ekle:
   ```env
   USE_LOCAL_TRACKER_PAGE=1
   ```
   (İsteğe bağlı: `SMOKE_SITE_ID=<site-uuid>` — gerçek site ID ile Forward da denenecek; yoksa placeholder kullanılır, Forward N/A sayılır.)

2. Çalıştır:
   ```bash
   npm run smoke:tank-tracker-offline
   ```
   veya
   ```bash
   npm run smoke:tank-tracker-all
   ```

Script `public/smoke-tracker-test.html` ve `public/ux-core.js` ile yerel bir HTTP sunucu açar; Store (offline sonrası outbox_v2 dolu) kanıtlanır. Forward yerel sayfada API olmadığı için N/A sayılır.
