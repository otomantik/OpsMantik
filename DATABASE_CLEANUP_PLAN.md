# Database Temizlik Planı - Şubat 2026

## Problem
- Şubat ayına geçişte partition key drift oluştu
- Worker ve trigger'lar farklı hesaplama yapıyordu
- Session'lar yanlış partition'lara gidiyordu → "bugün boş" sorunu

## Çözüm Adımları

### 1. Migration Çalıştır (Supabase SQL Editor)
```sql
-- supabase/migrations/20260201210000_comprehensive_partition_cleanup_and_fix.sql
-- Bu migration:
--   - Mevcut drift'leri temizler
--   - Trigger'ları doğru ayarlar (her INSERT için çalışır)
--   - FK'yi deferrable yapar (güvenli repair için)
```

### 2. Worker Deploy (Vercel)
```bash
git add .
git commit -m "fix: comprehensive partition cleanup + trigger alignment"
git push
```

### 3. Doğrulama (Supabase SQL Editor)
```sql
-- Drift kaldı mı?
SELECT COUNT(*) AS bad_sessions
FROM public.sessions s
WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date;

SELECT COUNT(*) AS bad_events
FROM public.events e
JOIN public.sessions s ON s.id = e.session_id
WHERE e.session_month <> s.created_month;

-- Her ikisi de 0 olmalı!
```

### 4. Canlı Test
1. Bir WordPress sayfasını aç
2. DevTools → Network → `POST /api/sync` → 200 OK kontrolü
3. 5 dakika bekle
4. SQL'de son 10 dakikada session var mı kontrol et:
```sql
SELECT COUNT(*) FROM public.sessions 
WHERE created_at >= now() - INTERVAL '10 minutes';
```

## Nasıl Çalışıyor?

### Sessions
1. Worker `dbMonth` hesaplar (UTC ay)
2. SessionService `created_month: dbMonth` set eder
3. **Trigger `BEFORE INSERT` çalışır ve `created_month`'u override eder** (UTC ay'dan hesaplar)
4. Sonuç: Her zaman doğru partition'a gider

### Events
1. EventService `session_month: session.created_month` set eder
2. **Trigger `BEFORE INSERT` çalışır ve `session_month`'u session'dan alır**
3. Sonuç: Her zaman session'ın partition'ına gider

## Önemli Notlar
- Trigger'lar **her zaman** çalışır (worker'ın gönderdiği değerleri override eder)
- `created_month` ve `session_month` **sadece trigger tarafından** set edilmeli
- Worker'ın `dbMonth` hesaplaması trigger ile uyumlu (UTC ay)
- Migration idempotent (birden fazla kez çalıştırılabilir)
