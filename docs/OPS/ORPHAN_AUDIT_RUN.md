# Orphan Audit — Nasıl Çalıştırılır

**Amaç:** P0 veri bütünlüğü kontrolleri (partition drift, orphan calls/events).

---

## Adımlar

1. **Supabase Dashboard** → SQL Editor aç
2. `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` dosyasını aç
3. **A) ve B) bölümlerini** sırayla çalıştır:

### A) Partition drift (beklenen: 0)
```sql
SELECT COUNT(*) AS bad_sessions_partition_key FROM ...;
SELECT COUNT(*) AS bad_events_partition_key FROM ...;
```

### B) Orphans (beklenen: 0)
```sql
SELECT COUNT(*) AS calls_with_missing_session FROM ...;
SELECT COUNT(*) AS events_with_missing_session FROM ...;
```

4. **Sonuç:** Tüm count'lar 0 olmalı. Değilse:
   - `calls_with_missing_session > 0` → call-match flow incele
   - `events_with_missing_session > 0` → partition drift migration çalıştır

---

## Sıklık

- **Release öncesi** veya **aylık** çalıştır
- CI'a eklenebilir (Supabase service role + `psql` veya custom RPC)

---

**İlgili:** `docs/AUDIT/CLEANUP_BACKLOG.md`, `docs/AUDIT/SYSTEM_AUDIT_REPORT.md`
