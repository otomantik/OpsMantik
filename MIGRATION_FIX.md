# 🔧 Migration Sorunu Çözümü

## Sorun
Remote'da `20260124184005` migration'ı var ama local'de yok. Bu hard reset sırasında silinmiş.

## Çözüm Seçenekleri

### Seçenek 1: Migration Repair (Önerilen)
Remote migration'ı "reverted" olarak işaretle:

```bash
supabase migration repair --status reverted 20260124184005
```

Sonra yeni migration'ları uygula:

```bash
supabase db push
```

### Seçenek 2: Remote'dan Pull
Remote schema'yı local'e çek:

```bash
supabase db pull
```

Bu, remote'daki tüm migration'ları local'e indirir.

### Seçenek 3: Manuel SQL (Supabase Dashboard)
1. Supabase Dashboard > SQL Editor'e git
2. Migration dosyalarını sırayla çalıştır:
   - `20260125000000_initial_schema.sql`
   - `20260125000001_phone_matching.sql`
   - `20260125000002_realtime_setup.sql`

## Hızlı Çözüm

Eğer Supabase CLI yüklü değilse:

1. **Supabase CLI'yı yükle:**
   ```bash
   npm i -g supabase
   ```

2. **Projeyi bağla:**
   ```bash
   supabase link --project-ref jktpvfbmuoqrtuwbjpwl
   ```

3. **Migration repair:**
   ```bash
   supabase migration repair --status reverted 20260124184005
   ```

4. **Yeni migration'ları uygula:**
   ```bash
   supabase db push
   ```

## Alternatif: Supabase Dashboard

1. Supabase Dashboard > Database > Migrations
2. `20260124184005` migration'ını görüntüle
3. SQL Editor'de yeni migration dosyalarını çalıştır
