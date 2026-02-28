# maintain-db

Edge Function that calls `create_next_month_partitions()` so next month's `sessions_YYYY_MM` and `events_YYYY_MM` partitions exist. Run **once per month** (e.g. 25th) so the 1st never fails.

## Deploy

```bash
supabase functions deploy maintain-db
```

## Scheduling (Supabase has no `schedule` in config.toml)

**Önerilen (içeride, başka yere gitmeden):** pg_cron ile veritabanında zamanlama:

1. **Supabase Dashboard** → Database → **Extensions** → `pg_cron` aç.
2. Migration zaten var; push et:
   ```bash
   supabase db push
   ```
   `20260129110000_schedule_partitions_pgcron.sql` her ayın 25’i 03:00’te `create_next_month_partitions()` çalıştırır. Edge Function veya dış cron gerekmez.

Alternatif (dış cron kullanmak istersen):

### A) External cron (pg_cron açmak istemezsen)

Use [cron-job.org](https://cron-job.org), GitHub Actions, or Vercel Cron to **POST** once a month:

- **URL:** `https://api.opsmantik.com/functions/v1/maintain-db` (or `https://<PROJECT_REF>.supabase.co/functions/v1/maintain-db` if using default)
- **Method:** POST
- **Header:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
- **Cron:** `0 3 25 * *` (25th of every month, 03:00)

Keep the service role key in the cron provider’s secrets.

### B) pg_cron + pg_net (Dashboard)

1. Enable **pg_cron** and **pg_net** in Supabase: Database → Extensions.
2. Store URL and key in Vault (Dashboard → SQL):

   ```sql
   SELECT vault.create_secret('https://api.opsmantik.com', 'project_url');
   SELECT vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
   ```

3. Schedule the function (run once):

   ```sql
   SELECT cron.schedule(
     'maintain-db-monthly',
     '0 3 25 * *',
     $$
     SELECT net.http_post(
       url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/maintain-db',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
       ),
       body := '{}'::jsonb
     ) AS request_id;
     $$
   );
   ```

## Manual test

**Bash / Git Bash / WSL:**
```bash
curl -X POST "https://api.opsmantik.com/functions/v1/maintain-db" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

**PowerShell (Windows):**  
PowerShell’de `curl` aslında `Invoke-WebRequest` olduğu için aşağıdaki kullanılır:

```powershell
$uri = "https://api.opsmantik.com/functions/v1/maintain-db"
$key = "YOUR_SERVICE_ROLE_KEY"   # veya: (Get-Content .env.local | Where { $_ -match 'SUPABASE_SERVICE_ROLE_KEY' }) -replace '^SUPABASE_SERVICE_ROLE_KEY=', ''
Invoke-RestMethod -Method POST -Uri $uri -Headers @{ "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }
```

Gerçek curl (Windows 10+) kullanmak istersen:
```powershell
curl.exe -X POST "https://api.opsmantik.com/functions/v1/maintain-db" -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" -H "Content-Type: application/json"
```

Expected: `{"message":"Success"}` with HTTP 200.
