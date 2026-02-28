# DEPLOY GATE — Intent Multi-Site Test (KESİN EMİR)

> **Intent bizim belkemiğimiz.** Bu test çalıştırılmadan deploy edilmeyecek.
> Aksi belirtilene kadar bu kesin bir emirdir. Unutulursa vay halimize.

## Zorunlu Adım

Her deploy öncesi:

```bash
npm run smoke:intent-multi-site
```

**2/2 site PASS** olmadan deploy yapılmayacak.

## Test Edilen Siteler (varsayılan)

- yapiozmendanismanlik.com
- poyrazantika.com

## Ortam

- `SYNC_API_URL` = https://console.opsmantik.com/api/sync
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (.env.local)

## Özel Site Listesi

```bash
P0_SITES="yapiozmendanismanlik.com,poyrazantika.com,yoursite.com" npm run smoke:intent-multi-site
```
