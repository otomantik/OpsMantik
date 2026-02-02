# Canlıda Eski Görünüm — Kontrol Listesi

Localhost’ta yeni dashboard (HunterCard, HOT LEAD, AI Özet) görünüyor ama canlıda eski görünüm kalıyorsa büyük ihtimalle **cache** veya **eski build**’dir.

## 1. Tarayıcı cache’ini atla

- **Hard refresh:** `Ctrl+Shift+R` (Windows) / `Cmd+Shift+R` (Mac)
- Veya **gizli pencere** ile canlı siteyi aç; eski cache kullanılmaz

## 2. Vercel’de hangi commit canlı?

- Vercel Dashboard → **Deployments**
- En üstteki (Production) deployment’ın **commit mesajı** ve **tarihi** ne?
- Son push’un commit’i bu mu? Değilse yeni deploy tetiklenmemiş veya farklı branch deploy ediliyor olabilir.

## 3. Yeniden deploy tetikle

- Vercel → **Deployments** → en son commit’in yanındaki **⋯** → **Redeploy**
- “Use existing Build Cache” **kapalı** olsun (temiz build)
- Bitince canlı URL’i tekrar **gizli pencerede** aç

## 4. Kod tarafında yapılanlar

- Dashboard sayfasına `dynamic = 'force-dynamic'` ve `revalidate = 0` eklendi; sayfa artık statik cache’e alınmıyor, her istek güncel build ile döner.
- Bu değişikliği commit + push edip yukarıdaki redeploy’u yap.

## 5. Hâlâ eskiyse

- Vercel → **Settings** → **Environment Variables**: Production’da `ENABLE_NEW_DASHBOARD` veya benzeri bir override var mı kontrol et (projede böyle bir env yok, sadece kod içi flag var).
- **Build Logs**: Son deployment’ın build log’unda hata var mı, tüm sayfalar derlenmiş mi bak.

## Özet komutlar (yeniden canlıya almak için)

```bash
git add app/dashboard/site/[siteId]/page.tsx docs/WAR_ROOM/CANLI_ESKI_GORUNUM.md
git commit -m "fix: dashboard force-dynamic, canlı cache önleme"
git push
```

Push sonrası Vercel otomatik deploy alır; bitince **gizli pencere** ile canlıyı test et.
