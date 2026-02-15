# G1–G5 durum ve production

## Master’da olanlar (kod + migration)

| PR | Master’da? | Açıklama |
|----|------------|----------|
| **G0** | ✅ | Provider registry + interfaces |
| **G4** | ✅ | Worker loop: migration (v2 kolonlar + `claim_offline_conversion_jobs_v2`), route, backoff, test, doc |
| **G5** | ✅ | Audit log tablosu + invoice_freeze / dispute_export yazımı |

## Master’da olmayanlar

| PR | Durum | Gerek |
|----|--------|------|
| **G1** | ❌ master’da yok | Vault + `provider_credentials` tablosu; G4 worker credential decrypt için bunlara ihtiyaç duyuyor |
| **G2** | ⚠️ kısmen | Queue v2 kolonları G4 migration içinde (ADD COLUMN IF NOT EXISTS) var; ayrı G2 branch merge edilmemiş olabilir |
| **G3** | ❌ master’da yok | Google Ads adapter (auth, mapper, types); G4 worker upload için kullanıyor |

## Production’a uygulama

1. **Kod (Vercel)**  
   Master push edildiği için Vercel “deploy from master” kullanıyorsa **G0, G4, G5 kodu prod’da**.  
   Yani: yeni route’lar ve audit log kodu prod’da var.

2. **Veritabanı (Supabase)**  
   Master’daki migration’lar **Supabase’de çalıştırılmış olmalı**:
   - `20260218140000_process_offline_conversions_worker.sql` (queue v2 + claim RPC)
   - `20260219100000_audit_log_g5.sql` (audit_log tablosu)  
   Bunlar çalıştırılmadıysa prod DB güncel değildir.

3. **G4 cron tetiklemesi**  
   `POST /api/cron/process-offline-conversions` şu an **vercel.json crons listesinde yok**.  
   Eklenmeden otomatik schedule ile çalışmaz; manuel curl veya başka scheduler gerekir.

4. **G4’ün gerçekten çalışması**  
   Worker’ın upload yapabilmesi için:
   - **G1** merge + deploy: vault + `provider_credentials` tablosu ve migration’ları prod’da olmalı.
   - **G3** merge + deploy: Google Ads adapter (auth, mapper, types) prod’da olmalı.  
   Bunlar yoksa cron çağrılsa bile credential/upload adımları hata verir veya RETRY’a düşer.

## Özet: “G1–5 PR bitti, prod’a uygulandı mı?”

- **Bitti sayılan:** G0, G4, G5 master’da; merge/push yapıldı.
- **Prod’da kod:** Master’dan deploy alıyorsan G0, G4, G5 kodu prod’da.
- **Prod’da tam “uygulandı” demek için:**  
  - Supabase’de yukarıdaki iki migration çalıştırılmış olmalı.  
  - G4 cron’u kullanacaksan `vercel.json` crons’a eklenmeli.  
  - G4’ün upload’ı için G1 + G3 master’a alınıp deploy ve ilgili migration’lar prod’da uygulanmalı.

## Sonraki adımlar (isteğe bağlı)

1. G1 ve G3 branch’lerini master’a merge edip deploy.
2. Supabase’de migration’ları çalıştır (henüz yapılmadıysa).
3. `vercel.json` crons’a `process-offline-conversions` ekle (eklendiği varsayılıyor; kontrol et).
