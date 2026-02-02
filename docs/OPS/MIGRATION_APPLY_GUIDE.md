# 🚀 Migration Uygulama Rehberi

## Problem: 404 Not Found - `get_recent_intents_v1` RPC

**Hata:** `POST https://jktpvfbmuoqrtuwbjpwl.supabase.co/rest/v1/rpc/get_recent_intents_v1 404 (Not Found)`

**Neden:** Database migration'ları production'a uygulanmamış. RPC fonksiyonları veritabanında yok.

---

## ✅ Çözüm: 3 Adımda Migration Uygulama

### Adım 1: Supabase CLI Kontrolü

```powershell
# Proje dizinine git
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1

# Supabase CLI kurulu mu kontrol et
supabase --version
```

Eğer kurulu değilse:
```powershell
npm i -g supabase
```

### Adım 2: Proje Bağlantısı

```powershell
# Production projesine bağlan
supabase link --project-ref jktpvfbmuoqrtuwbjpwl
```

**Not:** Eğer zaten bağlıysa, bu adımı atlayabilirsiniz.

### Adım 3: Migration'ları Uygula

```powershell
# Tüm pending migration'ları production'a push et
supabase db push
```

**Beklenen Çıktı:**
```
Applying migration 20260128030000_ads_session_predicate...
Applying migration 20260128031100_fix_is_ads_session_input_signature...
Applying migration 20260128024000_dashboard_session_rpcs...
Applying migration 20260128038000_calls_inbox_fields...
Applying migration 20260128038100_rpc_get_recent_intents_v1...
Applying migration 20260128038200_rpc_get_session_timeline...
Applying migration 20260128038300_rpc_get_recent_intents_v1_coalesce_fields...
Finished supabase db push.
```

---

## 🔍 Doğrulama: RPC'ler Var mı?

### Yöntem 1: Otomatik Script (Önerilen)

```powershell
node scripts/verify-rpc-exists.mjs
```

**Beklenen Çıktı (Başarılı):**
```
🔍 Verifying Supabase RPC functions...

📍 Supabase URL: https://jktpvfbmuoqrtuwbjpwl.supabase.co

✅ get_recent_intents_v1      EXISTS
✅ get_session_details        EXISTS
✅ get_session_timeline        EXISTS
✅ is_ads_session             EXISTS
============================================================

✅ ALL RPCs EXIST - Database migrations are applied!
```

### Yöntem 2: Supabase Dashboard SQL Editor

1. [Supabase Dashboard](https://supabase.com/dashboard/project/jktpvfbmuoqrtuwbjpwl) → SQL Editor
2. Şu sorguyu çalıştır:

```sql
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN (
    'get_recent_intents_v1',
    'get_session_details', 
    'get_session_timeline',
    'is_ads_session'
  )
ORDER BY routine_name;
```

**Beklenen:** 4 satır dönmeli (her RPC için bir satır)

---

## 🐛 Sorun Giderme

### Hata: "Project not linked"

**Çözüm:**
```powershell
supabase link --project-ref jktpvfbmuoqrtuwbjpwl
```

### Hata: "Migration already applied"

**Durum:** Normal. Bu migration zaten uygulanmış demektir. Diğer migration'lara devam eder.

### Hata: "Permission denied" veya "Authentication failed"

**Çözüm:**
1. Supabase Dashboard → Settings → Access Tokens
2. Yeni bir access token oluştur
3. Terminal'de login:
```powershell
supabase login
```

### Hata: "Function already exists with different definition"

**Çözüm:** Bu durumda migration'ı force replace etmek gerekebilir. Önce mevcut fonksiyonu kontrol edin:

```sql
-- Supabase Dashboard SQL Editor'da çalıştır
SELECT prosrc FROM pg_proc WHERE proname = 'get_recent_intents_v1';
```

Eğer eski bir versiyon varsa, migration dosyasındaki `CREATE OR REPLACE` zaten bunu düzeltecektir. `supabase db push` tekrar çalıştırın.

---

## 📋 Uygulanması Gereken Migration'lar (Sıralı)

1. ✅ `20260128030000_ads_session_predicate.sql` - `is_ads_session()` helper
2. ✅ `20260128031100_fix_is_ads_session_input_signature.sql` - `is_ads_session()` düzeltme
3. ✅ `20260128024000_dashboard_session_rpcs.sql` - `get_session_details()` RPC
4. ✅ `20260128038000_calls_inbox_fields.sql` - `calls` tablosuna yeni kolonlar
5. ✅ `20260128038100_rpc_get_recent_intents_v1.sql` - `get_recent_intents_v1()` RPC
6. ✅ `20260128038200_rpc_get_session_timeline.sql` - `get_session_timeline()` RPC
7. ✅ `20260128038300_rpc_get_recent_intents_v1_coalesce_fields.sql` - `get_recent_intents_v1()` güncelleme

**Toplam:** 7 migration dosyası

---

## ✅ Migration Sonrası Kontrol Listesi

- [ ] `supabase db push` başarıyla tamamlandı
- [ ] `node scripts/verify-rpc-exists.mjs` → Tüm RPC'ler EXISTS
- [ ] Dashboard'u hard refresh yap (Ctrl+Shift+R)
- [ ] Browser DevTools → Network tab → 404 hataları yok
- [ ] Browser DevTools → Console → RPC hataları yok
- [ ] Live Inbox component'i veri gösteriyor

---

## 🎯 Hızlı Referans

```powershell
# Tek komutla tüm süreç
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1; supabase link --project-ref jktpvfbmuoqrtuwbjpwl; supabase db push; node scripts/verify-rpc-exists.mjs
```

**PowerShell için (satır satır):**
```powershell
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1
supabase link --project-ref jktpvfbmuoqrtuwbjpwl
supabase db push
node scripts/verify-rpc-exists.mjs
```

---

## 📞 Yardım

Eğer migration push başarısız olursa:

1. **Hata mesajını kopyala** (tam hata log'u)
2. **Migration dosyasını kontrol et** (`supabase/migrations/` altında)
3. **Supabase Dashboard → Database → Migrations** bölümünde migration geçmişini kontrol et

**Not:** Migration'lar geri alınamaz (rollback yok). Bu yüzden production'a push etmeden önce local'de test edin (eğer local Supabase kurulumunuz varsa).
