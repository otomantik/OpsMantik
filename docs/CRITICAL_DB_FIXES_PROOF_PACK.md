# 🔧 Critical Database Fixes - Proof Pack

## Migration: `20260128039000_critical_db_fixes.sql`

### ✅ Düzeltilen Sorunlar

#### 1. **Mühür (Idempotency) Koruması** ✅
- **Sorun:** `intent_stamp` var ama UNIQUE değil → Aynı mühürle 100 istek = 100 kayıt
- **Çözüm:** Partial UNIQUE index eklendi: `idx_calls_site_intent_stamp_uniq`
  - `WHERE intent_stamp IS NOT NULL` → NULL'lar çoklanabilir, non-NULL'lar unique
  - Eski full UNIQUE constraint kaldırıldı (partial index daha esnek)

#### 2. **phone_number NULLABLE** ✅
- **Sorun:** `phone_number TEXT NOT NULL` → Contact Form/WhatsApp linklerinde sorun
- **Çözüm:** `ALTER COLUMN phone_number DROP NOT NULL`
  - Artık genel intent tablosu olarak kullanılabilir
  - `intent_target` zaten normalized storage için mevcut

#### 3. **UUID Function Migration** ✅
- **Sorun:** `uuid_generate_v4()` → `uuid-ossp` extension bağımlılığı (eski)
- **Çözüm:** Tüm tablolarda `gen_random_uuid()` kullanımına geçildi
  - PostgreSQL native (9.4+), extension gerektirmez
  - **Etkilenen tablolar:** `sites`, `events`, `calls`, `user_credentials`

#### 4. **Events FK Cleanup** ✅
- **Sorun:** Partition'larda duplicate FK constraint'ler olabilir
- **Çözüm:** Warning log ile kontrol eklendi
  - Parent `events` tablosunda tek FK var (doğru)
  - Partition'larda duplicate FK varsa uyarı verir

#### 5. **Calls -> Sessions Index** ✅
- **Durum:** Index zaten var (`idx_calls_matched_session`)
- **Doğrulama:** Migration'da varlığı kontrol edilir, yoksa oluşturulur

---

## 📋 Migration Uygulama

```powershell
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1
supabase db push
```

---

## ✅ Doğrulama Sorguları

### 1. Intent Stamp Unique Index Kontrolü

```sql
SELECT 
  indexname, 
  indexdef 
FROM pg_indexes 
WHERE tablename = 'calls' 
  AND indexname = 'idx_calls_site_intent_stamp_uniq';
```

**Beklenen:** 1 satır, `WHERE intent_stamp IS NOT NULL` içermeli

### 2. Phone Number Nullable Kontrolü

```sql
SELECT 
  column_name, 
  is_nullable,
  data_type
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND table_name = 'calls' 
  AND column_name = 'phone_number';
```

**Beklenen:** `is_nullable = 'YES'`

### 3. UUID Default Kontrolü

```sql
SELECT 
  table_name, 
  column_name, 
  column_default 
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND column_default LIKE '%gen_random_uuid%'
ORDER BY table_name, column_name;
```

**Beklenen:** `sites.id`, `events.id`, `calls.id`, `user_credentials.id` → hepsi `gen_random_uuid()`

### 4. Idempotency Test (Manuel)

```sql
-- Test 1: Aynı stamp ile 2 insert → 2. insert başarısız olmalı
BEGIN;

INSERT INTO calls (site_id, intent_stamp, source, intent_action) 
VALUES ('00000000-0000-0000-0000-000000000000', 'test-stamp-uniq-123', 'click', 'phone');

-- Bu insert unique violation hatası vermeli:
INSERT INTO calls (site_id, intent_stamp, source, intent_action) 
VALUES ('00000000-0000-0000-0000-000000000000', 'test-stamp-uniq-123', 'click', 'phone');

ROLLBACK;
```

**Beklenen:** 2. INSERT → `ERROR: duplicate key value violates unique constraint "idx_calls_site_intent_stamp_uniq"`

### 5. Phone Number NULL Test

```sql
-- Test: phone_number olmadan insert → başarılı olmalı
INSERT INTO calls (site_id, source, intent_action, intent_target) 
VALUES ('00000000-0000-0000-0000-000000000000', 'click', 'whatsapp', 'wa:+905321796834')
RETURNING id, phone_number, intent_target;

-- phone_number NULL olmalı, intent_target dolu olmalı
```

**Beklenen:** `phone_number = NULL`, `intent_target = 'wa:+905321796834'`

---

## 🚨 Rollback Senaryosu

Eğer migration sorun çıkarırsa:

### Rollback 1: Intent Stamp Index

```sql
DROP INDEX IF EXISTS idx_calls_site_intent_stamp_uniq;

-- Eski constraint'i geri ekle (eğer gerekirse)
ALTER TABLE public.calls
  ADD CONSTRAINT calls_site_intent_stamp_uniq
  UNIQUE (site_id, intent_stamp);
```

### Rollback 2: Phone Number NOT NULL

```sql
-- Önce NULL değerleri temizle (eğer varsa)
UPDATE calls SET phone_number = '' WHERE phone_number IS NULL;

-- Sonra NOT NULL yap
ALTER TABLE public.calls
  ALTER COLUMN phone_number SET NOT NULL;
```

### Rollback 3: UUID Function

```sql
-- uuid-ossp extension'ı tekrar etkinleştir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Default'ları geri al
ALTER TABLE public.sites ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE public.events ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE public.calls ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE public.user_credentials ALTER COLUMN id SET DEFAULT uuid_generate_v4();
```

---

## 📊 Migration Öncesi/Sonrası Karşılaştırma

| Özellik | Öncesi | Sonrası |
|---------|--------|---------|
| `intent_stamp` unique | ❌ Yok (veya full constraint) | ✅ Partial index (NULL-safe) |
| `phone_number` nullable | ❌ NOT NULL | ✅ NULLABLE |
| UUID function | ❌ `uuid_generate_v4()` (extension) | ✅ `gen_random_uuid()` (native) |
| Events FK | ⚠️ Kontrol edilmeli | ✅ Parent-only (doğru) |
| Calls->Sessions index | ✅ Var | ✅ Var (doğrulandı) |

---

## ✅ PASS/FAIL Checklist

- [ ] Migration başarıyla uygulandı (`supabase db push` → success)
- [ ] `idx_calls_site_intent_stamp_uniq` index var ve partial (WHERE clause)
- [ ] `phone_number` column nullable
- [ ] Tüm UUID defaults `gen_random_uuid()` kullanıyor
- [ ] Idempotency test: duplicate stamp → unique violation
- [ ] Phone number NULL test: NULL phone_number ile insert başarılı
- [ ] Events FK: Parent'ta tek FK, partition'larda duplicate yok

---

## 🎯 Sonraki Adımlar

1. **Migration'ı uygula:** `supabase db push`
2. **Doğrulama sorgularını çalıştır** (yukarıdaki SQL'ler)
3. **Idempotency test yap** (manuel insert test)
4. **Production'da test et:** Dashboard'da duplicate intent oluşturmayı dene

---

## 📝 Notlar

- **uuid-ossp extension:** Migration sonrası kaldırılabilir (eğer başka yerde kullanılmıyorsa)
  ```sql
  DROP EXTENSION IF EXISTS "uuid-ossp"; -- Sadece hiçbir yerde kullanılmıyorsa
  ```
- **Events FK:** Parent table'da tek FK var, bu doğru. Partition'larda duplicate FK varsa manuel temizlik gerekebilir (migration sadece warning verir).
