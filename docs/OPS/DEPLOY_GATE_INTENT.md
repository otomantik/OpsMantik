# DEPLOY GATE — Intent Test (KESİN EMİR)

> **Intent bizim belkemiğimiz.** Bu test çalıştırılmadan deploy edilmeyecek.
> Aksi belirtilene kadar bu kesin bir emirdir. Unutulursa vay halimize.

## Zorunlu Adım

Her deploy öncesi:

```bash
npm run smoke:intent-multi-site
```

**1/1 site PASS** olmadan deploy yapılmayacak.

## Test Edilen Site (varsayılan)

- www.kocotokurtarma.com

## Ortam

- `SYNC_API_URL` = https://console.opsmantik.com/api/sync
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (.env.local)

## Özel Site Listesi

```bash
P0_SITES="www.kocotokurtarma.com,yoursite.com" npm run smoke:intent-multi-site
```

## Lokalden test (QStash olmadan)

Canlıya dokunmadan gate’i geçmek için testi lokale yönlendirip sync’in worker’a doğrudan HTTP atmasını sağlayabilirsin. Worker normalde QStash imzası ister; lokalde imza olmadan kabul etmesi için bypass gerekir.

1. **.env.local** içine ekle:
   ```env
   OPSMANTIK_SYNC_DIRECT_WORKER=1
   ALLOW_INSECURE_DEV_WORKER=true
   ```
   (`ALLOW_INSECURE_DEV_WORKER=true` olmazsa worker 403 QSTASH_SIGNATURE_MISSING döner, sync 503 olur.)
2. Uygulamayı başlat (veya yeniden başlat): `npm run dev`
3. Başka bir terminalde:  
   `$env:SYNC_API_URL="http://localhost:3000/api/sync"; npm run smoke:intent-multi-site`  
   (Windows PowerShell; macOS/Linux: `SYNC_API_URL=http://localhost:3000/api/sync npm run smoke:intent-multi-site`)

Sync, QStash yerine `/api/workers/ingest`’e doğrudan istek atar; worker imza kontrolünü atlar; event/call DB’ye yazılır ve test PASS olur.
