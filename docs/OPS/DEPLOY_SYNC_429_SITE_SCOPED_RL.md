# Deploy: Site-scoped rate limit (sync 429 fix)

Poyraz Antika’da 429 yüzünden event gelmemesi için **site-scoped rate limit** kodu `master`’da. Production’da canlıya almak için aşağıdakilerden birini yapın.

## CORS: Origin izin listesi (429 / CORS hatası alıyorsanız)

Sync ve call-event API’leri sadece **ALLOWED_ORIGINS** içindeki origin’lere izin verir. Poyraz Antika için production’da şunlardan biri mutlaka tanımlı olmalı:

- `https://www.poyrazantika.com`
- veya `https://poyrazantika.com` (alt alan adları da kabul edilir)

**Vercel → Settings → Environment Variables:**

- **Key:** `ALLOWED_ORIGINS`
- **Value:** Mevcut değerin sonuna ekleyin: `,https://www.poyrazantika.com` (veya virgülle ayrılmış tam liste, örn. `https://console.opsmantik.com,https://www.poyrazantika.com,...`)

Kaydet + Production redeploy. Origin listede değilse 403 döner; tarayıcı bunu CORS hatası gibi gösterebilir.

## Acil rahatlama: Site limit override (bugün hiç event gelmiyorsa)

Vercel (veya hosting) **Environment Variables** bölümüne ekleyin:

- **Name:** `OPSMANTIK_SYNC_RL_SITE_OVERRIDE`
- **Value:** `b3e9634575df45c390d99d2623ddcde5:500`

Bu site için limit 100 yerine **500/dk** olur; event’ler tekrar akmaya başlar. Deploy’u tetikleyin (save + redeploy). İstediğiniz zaman kaldırıp varsayılan 100’e dönebilirsiniz.

## 1) Vercel otomatik deploy (GitHub bağlıysa)

`master`’a push edildiyse Vercel genelde kendisi deploy alır.

- **Kontrol:** [Vercel Dashboard](https://vercel.com) → Proje → Deployments. En son deployment `master` (commit `726581c` veya sonrası) ise deploy zaten çalışmış olabilir.
- **Yeni deploy:** Aynı sayfada **Redeploy** (son deployment’a tıkla → Redeploy) veya yeni bir commit push’la tetikleyin.

## 2) Vercel CLI ile deploy

```bash
cd /path/to/opsmantik-v1
npx vercel --prod
```

Gerekirse önce `npx vercel login` ile giriş yapın.

## 3) Deploy sonrası kontrol

1. **API yanıtı:** Poyraz’dan bir istek 429 aldığında response header’da **`Retry-After`** olmalı (yeni kod).
2. **Teşhis scripti:**
   ```bash
   node scripts/check-poyraz-ingest.mjs
   ```
   Bir süre sonra “Events today” ve “ingest_idempotency rows today” artmalı.

## Commit (merge)

- `726581c` — merge: sync 429 TMS hardening (site-scoped RL + Retry-After + batch/throttle + P1 hardening).
