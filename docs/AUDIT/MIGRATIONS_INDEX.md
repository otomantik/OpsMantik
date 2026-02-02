# SQL Migrations & Audit — Tek Referans

Bu dosya tüm SQL dosyalarını ve ne işe yaradıklarını özetler. Dağınıklığı bitirir.

---

## 1. supabase/migrations/ — Resmi Şema (DOKUNMA)

Bunlar Supabase’in sırayla uyguladığı migration’lar. Zaten çalışmış olanları silme/değiştirme, sadece yeni ekle.

### Fix / Backfill Zinciri (karışan kısım)

| Dosya | Ne yapar | Neden var |
|-------|----------|-----------|
| `20260130250700_backfill_sessions_utm_from_entry_page.sql` | UTM’i sadece query string (?) içinden alır | İlk UTM backfill |
| `20260202000000_backfill_utm_term_from_entry_page_fragment.sql` | UTM’i hash (#) içinden de alır | Google Ads redirect’te UTM # sonrasında geliyor |
| `20260202010000_rerun_backfill_utm_from_entry_page_fragment.sql` | Aynı backfill’i tekrar çalıştırır | İlk çalışmadan sonra oluşan satırlar için |
| `20260202020000_fix_get_recent_intents_v2_arg_limit.sql` | RPC argüman limiti (100) hatasını giderir | to_jsonb ile argüman sayısını azaltır |
| `20260202021000_enrich_get_recent_intents_v2_to_jsonb_full.sql` | get_recent_intents_v2 çıktısını zenginleştirir | arg_limit fix sonrası alanları geri ekler |
| `20260201190000_fix_partition_key_drift_and_guardrails.sql` | FK deferrable, partition drift onarımı | events.session_month <> sessions.created_month |
| `20260201210000_comprehensive_partition_cleanup_and_fix.sql` | Partition + trigger düzenlemesi | Kapsamlı drift temizliği |
| `20260202030000_fix_events_partition_drift_only.sql` | Sadece events partition drift’i düzeltir | Tek başına çalıştırılabilir (idempotent) |

### UTM Backfill Özeti

- **30250700:** Sadece `?utm_term=...` (query)
- **202000000:** `?` ve `#` içinden utm_term/matchtype
- **202100000:** Aynı backfill’i “rerun” (yeni satırlar için)

Üçü de farklı ihtiyaçlardan doğdu; migration sırası değiştirilmemeli.

---

## 2. docs/AUDIT/ — İzleme ve Kontrol (Read-Only)

### Ana Dosyalar (BUNLARI KULLAN)

| Dosya | Amaç | Ne zaman çalıştırılır |
|-------|------|------------------------|
| **CLEANUP_QUICK_AUDIT.sql** | Tek doğruluk kontrol paketi | Haftada 1 veya deploy sonrası |
| **CLEANUP_QUICK_AUDIT.md** | Sonuçların nasıl yorumlanacağı | Audit sonrası |
| **CLEANUP_BACKLOG.md** | P0/P1/P2 bulgular ve plan | Temizlik planı için |

### Arşivde (eski ad-hoc)

| Dosya | Amaç |
|-------|------|
| EMERGENCY_CHECK.sql | Acil kontrol: QStash, signal, session |
| HUNTER_CARD_KEYWORD_FLOW.sql | Keyword neden gelmiyor analizi |
| PROOF_GCLID_KEYWORDS.sql | GCLID + keyword kanıt sorguları |
| test-tracking-now.sql | QStash deploy sonrası hızlı test |

Konum: `docs/_archive/2026-02-02/audit-ad-hoc/`

---

## 3. Hangi SQL Dosyasını Ne Zaman Çalıştıracağım?

| Durum | Kullan |
|-------|--------|
| Haftalık / deploy sonrası kontrol | `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` |
| Partition drift (bad_events_partition_key > 0) | `supabase/migrations/20260202030000_fix_events_partition_drift_only.sql` (manuel, tek sefer) |
| UTM backfill (yeni satırlar için) | Zaten migration zincirinde; yeni migration gerekirse ekle |
| Acil “sistem çalışıyor mu?” | Eski EMERGENCY_CHECK veya test-tracking-now (arşivde) |

---

## 4. Kısa Özet

- **supabase/migrations/**: Resmi şema; sıra önemli, silme/değiştirme yapma.
- **docs/AUDIT/CLEANUP_QUICK_AUDIT.sql**: Tek periyodik kontrol dosyası.
- **docs/AUDIT/ad-hoc/** (eski): Arşive taşındı → `docs/_archive/2026-02-02/audit-ad-hoc/`
