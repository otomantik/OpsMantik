# scripts/db — Veritabanı Sık Kullanılan Scriptler

Supabase'e karşı sık yaptığımız işlemler: kuyruğa alma, credentials, günlük sorgular.

## Gereksinim

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Scriptler

| Script | Kullanım | Açıklama |
|--------|----------|----------|
| `oci-enqueue.mjs` | `node scripts/db/oci-enqueue.mjs Eslamed` | OCI kuyruğa alma + FAILED/RETRY/PROCESSING/COMPLETED reset |
| `oci-queue-check.mjs` | `node scripts/db/oci-queue-check.mjs Eslamed` | Kuyruk durumu + export'a gidecek satirlar |
| `oci-credentials.mjs` | `node scripts/db/oci-credentials.mjs Eslamed --write` | OCI credentials (site_id, api_key) bulup scripte yaz |
| `oci-daily.mjs` | `node scripts/db/oci-daily.mjs Eslamed` | Günlük özet, bugün Google sonucu |

## NPM Scripts (package.json)

```bash
npm run db:enqueue Eslamed
npm run db:enqueue:today          # Eslamed, sadece bugunun muhurleri
npm run db:credentials Eslamed -- --write
npm run db:daily Eslamed
```

## Enqueue Parametreleri

- `--today` / `-t`: Sadece bugunun muhurleri (confirmed_at >= bugun)
- `--force-reset-completed` / `-f`: Tum COMPLETED satirlari QUEUED'e al (toparlama; normalde sadece uploaded_at null olanlar)
- `--dry-run` / `-n`: Sadece ne yapilacagini goster, INSERT/reset yapma

## "Islenecek kayit bulunamadi" Cözümü

1. `npm run db:queue-check Eslamed` ile kuyrugu kontrol et
2. QUEUED/RETRY yoksa: `npm run db:enqueue:fix` (bugun + tum COMPLETED reset)
3. Sonra Google Ads script'ini calistir
