# 🔄 Veritabanı Durumu ve Kurtarma Rehberi

## ⚠️ ÖNEMLİ: Verileriniz Güvende!

**Hard reset sadece local dosyaları temizledi. Supabase veritabanınıza dokunulmadı!**

Veritabanınız Supabase'in sunucularında, local dosyalardan bağımsız.

## 🔍 Veritabanı Durumunu Kontrol Etme

```bash
npm run check-db
```

Bu komut şunları kontrol eder:
- ✅ Veritabanı bağlantısı
- ✅ Tabloların varlığı (sites, sessions, events, calls)
- ✅ Mevcut kayıt sayıları

## 📋 Migration Durumu

### Eğer Tablolar Yoksa:

Migration'ları uygulayın:

```bash
# Supabase CLI ile
supabase db push

# VEYA Supabase Dashboard'dan SQL Editor'de
# supabase/migrations/20260125000000_initial_schema.sql dosyasını çalıştırın
```

### Eğer Tablolar Varsa:

Hiçbir şey yapmanıza gerek yok! Verileriniz yerinde.

## 🛠️ Ne Yapıldı?

1. ✅ **Local dosyalar temizlendi** (hard reset)
2. ✅ **Migration dosyaları yeniden oluşturuldu**
3. ✅ **Component'ler ve sayfalar yeniden oluşturuldu**
4. ✅ **Veritabanına dokunulmadı** (Supabase uzakta)

## 📊 Veritabanı Tabloları

- `sites` - Site bilgileri
- `sessions` - Session kayıtları (partitioned)
- `events` - Event kayıtları (partitioned)
- `calls` - Telefon araması kayıtları
- `user_credentials` - OAuth token'ları

## 🔐 Güvenlik

- RLS (Row Level Security) aktif
- Her kullanıcı sadece kendi verilerini görebilir
- Service role key sadece API'de kullanılır

## ❓ Sorun Giderme

### "Table does not exist" hatası alıyorsanız:

```bash
# Migration'ları uygula
supabase db push
```

### "Permission denied" hatası alıyorsanız:

- `.env.local` dosyasındaki key'leri kontrol edin
- Supabase Dashboard'dan yeni key'ler alın

### Veriler görünmüyorsa:

- Dashboard'da kullanıcı girişi yaptığınızdan emin olun
- RLS policy'lerinin doğru çalıştığını kontrol edin
