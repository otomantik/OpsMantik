# Auth / Login Geçiş Sorun Giderme

Kullanıcı Google ile giriş yapıyor ama OAuth sonrası panele geçemiyorsa ("geçiş açılmıyor", "site açılmıyor") kontrol edilecekler:

---

## 1. Supabase Redirect URLs (En Sık Neden)

**Supabase Dashboard** → Proje → **Authentication** → **URL Configuration** → **Redirect URLs**

Şu URL'ler **mutlaka** listede olmalı:

```
https://console.opsmantik.com/auth/callback
https://console.opsmantik.com/**
```

**Site URL** alanı: `https://console.opsmantik.com` olmalı.

Eksikse ekleyip **Save** ile kaydedin. Değişiklik hemen geçerli olur.

---

## 2. Ortam Değişkenleri (Vercel)

Vercel → Project → Settings → Environment Variables:

| Değişken | Değer (Production) |
|----------|---------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.opsmantik.com` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (Supabase anon key) |
| `NEXT_PUBLIC_PRIMARY_DOMAIN` | `opsmantik.com` |

`NEXT_PUBLIC_*` değişiklikleri için **yeniden deploy** gerekir.

---

## 3. Tarayıcı / Ağ Kontrolü

- Farklı tarayıcı veya **gizli pencere** deneyin
- VPN kapatın
- Üçüncü parti cookie'ler engelli olabilir
- F12 → **Console** sekmesinde kırmızı hata var mı kontrol edin

---

## 4. Hata Mesajları

Login sayfasında `?error=...` ile dönüyorsa:

| Parametre | Anlam |
|-----------|-------|
| `config` | Supabase env eksik (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY) |
| `exchange` | Code-session exchange başarısız (code geçersiz, süresi dolmuş) |
| `no_session` | Session oluşturulamadı |
| `no_code` | Callback'te `code` parametresi yok (Redirect URL yanlış) |

---

## 5. OAuth Akış Özeti

1. Kullanıcı `/login` → "Google ile giriş" tıklar
2. `api.opsmantik.com/auth/v1/authorize?redirect_to=...` → Google OAuth
3. Google → `console.opsmantik.com/auth/callback?code=...` yönlendirir
4. Callback code'u session'a çevirir, cookie'leri set eder, `/dashboard`'a redirect
5. Middleware session'ı görür, dashboard yüklenir

---

## 6. Hâlâ Çalışmıyorsa

- Vercel deploy logları ve **Function logs** kontrol edin (auth callback 302 dönüyor mu)
- Supabase Auth logs: Dashboard → Authentication → Logs
