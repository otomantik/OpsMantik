# 🚨 RPC 404 Hatası - Hızlı Çözüm

## Problem
```
POST https://api.opsmantik.com/rest/v1/rpc/get_recent_intents_v1 404 (Not Found)
```

**Neden:** `get_recent_intents_v1` RPC fonksiyonu veritabanında yok. Migration'lar uygulanmamış.

---

## ⚡ Hızlı Çözüm (3 Komut)

```powershell
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1
supabase link --project-ref jktpvfbmuoqrtuwbjpwl
supabase db push
```

**Sonra doğrula:**
```powershell
npm run verify-rpcs
```

---

## ✅ Başarı Kontrolü

1. **Script çıktısı:** `✅ ALL RPCs EXIST`
2. **Dashboard:** Hard refresh (Ctrl+Shift+R)
3. **Network tab:** 404 hataları kaybolmalı

---

## 📖 Detaylı Rehber

Tam adımlar için: [`docs/MIGRATION_APPLY_GUIDE.md`](./MIGRATION_APPLY_GUIDE.md)

---

## 🔍 Hangi RPC'ler Eksik?

- ❌ `get_recent_intents_v1` (404)
- ❌ `get_session_details` (404)
- ❌ `get_session_timeline` (404)
- ❌ `is_ads_session` (dependency - 500 hatalarına neden olabilir)

**Hepsi migration push ile düzelecek.**
