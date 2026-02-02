# Google OAuth + Supabase — Redirect ayarları

Console’da “Sign in with Google” çalışması için **Google Cloud Console** ve **Supabase Dashboard**’da aşağıdaki değerleri eklemen yeterli. Hepsi kopyala-yapıştır.

---

## 1) Kopyala-yapıştır değerleri

| Nerede kullanılacak | Değer (kopyala-yapıştır) |
|---------------------|---------------------------|
| **Google → Authorized redirect URI** | `https://jktpvfbmuoqrtuwbjpwl.supabase.co/auth/v1/callback` |
| **Supabase → Redirect URL** | `https://console.opsmantik.com/auth/callback` |
| **Supabase → Site URL** (kontrol) | `https://console.opsmantik.com` |

Supabase proje ref’in farklıysa (farklı proje kullanıyorsan), ilk satırdaki `jktpvfbmuoqrtuwbjpwl` kısmını kendi proje ref’inle değiştir. Proje ref: Supabase Dashboard → Settings → General → Reference ID.

---

## 2) Google Cloud Console

1. [Google Cloud Console](https://console.cloud.google.com/) → projeyi seç.
2. **APIs & Services** → **Credentials**.
3. OAuth 2.0 Client ID’ye tıkla (Web application, client_id `847437361081-...` olan).
4. **Authorized redirect URIs** bölümünde **ADD URI**.
5. Şunu yapıştır:  
   `https://jktpvfbmuoqrtuwbjpwl.supabase.co/auth/v1/callback`
6. **Save**.

Birkaç dakika bekleyip tekrar “Sign in with Google” dene.

---

## 3) Supabase Dashboard

1. [Supabase Dashboard](https://supabase.com/dashboard) → projeyi aç.
2. **Authentication** → **URL Configuration**.
3. **Redirect URLs** bölümüne ekle:  
   `https://console.opsmantik.com/auth/callback`
4. **Site URL** şu olmalı:  
   `https://console.opsmantik.com`  
   (farklıysa düzelt, kaydet.)
5. Kaydet.

---

## 4) 403 org_internal — Sadece kendi organizasyonun girebiliyor

**Hata:** Google girişte `403` ve mesajda **org_internal** geçiyorsa, OAuth consent ekranı **Internal** (sadece senin Google Workspace organizasyonun) olarak ayarlı demektir. @gmail.com veya başka organizasyondan giriş engellenir.

**Çözüm:** Consent ekranını **External** (herkese açık) yap.

### Yol A — Doğrudan OAuth consent screen

1. Şu sayfayı aç: **[OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)**  
   (Proje seçili olmalı; üstte proje adı görünür.)
2. Sayfanın **en üstünde** “User type” satırına bak:
   - **Internal** yazıyorsa yanında **“MAKE EXTERNAL”** veya **“Change to External”** / **“Değiştir”** linki olabilir → tıkla ve onayla.
   - Böyle bir link yoksa **“EDIT APP”** / **“Uygulamayı Düzenle”** butonuna gir; ilk adımda (App information) **User type** seçeneği çıkabilir (Internal / External).
3. **External** seçili hale getir, kaydet.

### Yol B — Sol menüden (eski arayüz)

1. [Google Cloud Console](https://console.cloud.google.com/) → üstten **projeyi seç**.
2. Soldan **≡ Menü** → **APIs & Services** → **OAuth consent screen**.
3. Aynı şekilde sayfa üstünde **User type: Internal** ve yanında **MAKE EXTERNAL** / **EDIT APP** ara.

### Yol B2 — Google Auth Platform (yeni arayüz)

**OAuth Overview** veya **Branding** sayfasındaysan (sol menüde Google Auth Platform / Overview, Branding, Audience, Clients… görünüyorsa):

1. Sol menüden **Audience**’e tıkla.
2. “Who can use this app” / “Kimler kullanabilir” bölümünde **Internal** / **External** (veya Public) seçeneği vardır.
3. **External** (herkese açık) seç, kaydet.

### Yol C — Proje Workspace organizasyonuna aitse

Proje bir **Google Workspace** organizasyonuna bağlıysa, “External” seçeneği admin tarafından kapatılmış olabilir. O zaman:

- **Seçenek 1:** Workspace admin’e söyle; OAuth consent screen’de “External” / “Public” kullanıma izin versin.
- **Seçenek 2:** **Yeni bir Google Cloud projesi** oluştur (mümkünse **kişisel @gmail.com** hesabıyla, Workspace’e bağlı olmayan). Bu yeni projede OAuth consent screen’i ilk kurarken **User type: External** seç. Sonra bu projede yeni bir OAuth Client ID oluştur; Supabase Dashboard → Authentication → Providers → Google’da **Client ID ve Client Secret**’i bu yeni client’tan al.

### Kontrol

OAuth consent screen sayfasında **User type: External** (veya “Public”) yazıyorsa doğru. Kaydettikten sonra birkaç dakika bekleyip “Sign in with Google”ı tekrar dene.

**Not:** Internal → External geçiş geri alınamaz. Sadece kendi domain’in (@firma.com) giriş yapsın istiyorsan Internal kalır; @gmail.com ile giriş istiyorsan External şart.

---

## 5) “Bu uygulama doğrulanmamış” uyarısı (Google)

Google “This app isn’t verified” gösteriyorsa:

- **Hızlı (test):** Ekranda **Gelişmiş** / **Advanced** → **console.opsmantik.com adresine git (güvenli değil)** ile devam et.
- **Kalıcı:** Google Cloud Console → **APIs & Services** → **OAuth consent screen** → Test users’a kullanacağın Gmail adresini ekle veya uygulamayı “Production”a alıp doğrulama sürecine gir.

---

## 6) Kod tarafı (referans)

- **redirectTo (Google’a giden):** `app/login/page.tsx` — `NEXT_PUBLIC_PRIMARY_DOMAIN` ile `https://console.${primaryDomain}/auth/callback` üretiliyor.
- **Callback route:** `app/auth/callback/route.ts` — code alınıp Supabase’e veriliyor, sonra `https://console.${primaryDomain}/dashboard`’a yönlendiriliyor.
- **Env:** `.env.local` / Vercel’de `NEXT_PUBLIC_PRIMARY_DOMAIN=opsmantik.com` olmalı (production için).

Bu adımları yaptıktan sonra Google ile giriş çalışmıyorsa: tarayıcı konsolundaki hata + Supabase Auth → Logs’taki ilgili satırı paylaşırsan devam edebiliriz.
