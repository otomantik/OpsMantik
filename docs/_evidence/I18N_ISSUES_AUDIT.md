# i18n Sorun Envanteri — Tarama Raporu

**Tarih:** Phase 3.4 sonrası tam tarama

---

## 1. SÖZLÜKTE OLMAYAN ANAHTARLAR (t()/translate() kullanılıyor ama dictionary'de yok)

| Anahtar | Kullanıldığı Yer | Etki |
|---------|------------------|------|
| **table.time** | session-card-expanded.tsx (tablo başlığı) | Raw key gösterilir |
| **table.action** | session-card-expanded.tsx | Raw key gösterilir |
| **table.label** | session-card-expanded.tsx | Raw key gösterilir |
| **table.value** | session-card-expanded.tsx | Raw key gösterilir |
| **technical.clickId** | intent-card.tsx | Raw key gösterilir |
| **meta.title** | app/dashboard/site/[siteId]/page.tsx (generateMetadata) | meta için public.meta.title yerine kullanılıyor; fallback key |
| **meta.description** | app/dashboard/site/[siteId]/page.tsx | meta için; fallback key |
| **intent.whatsapp** | lib/i18n/mapping.ts | getLocalizedLabel içinde; event.whatsapp veya hunter.intentWhatsApp kullanılmalı |
| **setup.createTestSite** | site-switcher.tsx, site-setup.tsx | Raw key |
| **setup.creating** | site-setup.tsx | Raw key |
| **setup.created** | site-setup.tsx | Raw key |
| **setup.testPage** | site-setup.tsx | Raw key |

---

## 2. HARDCODED STRINGLER (t() kullanılmıyor)

| Dosya | Satır | Metin | Öneri |
|-------|-------|-------|-------|
| sites-manager.tsx | 124 | `'Failed to create site'` | sites.createFailed veya sites.errorLoading |
| site-setup.tsx | 29-31 | `'Failed to create test site'`, `'Unknown error'` | sites.createFailed, misc.unknown |
| site-setup.tsx | 46 | `'Unknown error'` | misc.unknown |

---

## 3. API YANITLARINA GÖRE KARŞILAŞTIRMA (Locale-bağımsız)

| Yer | Karşılaştırma | Sorun |
|-----|---------------|-------|
| sites-manager.tsx | `inviteSuccess[site.id].message === 'Customer invited successfully'` | API İngilizce döndürüyor; dil değişince kırılır |
| sites-manager.tsx | `siteStatus[site.id].status === 'Receiving events'` | API sabit string; kabul edilebilir (contract) |

---

## 4. META / PUBLIC NAMESPACE TUTARSIZLIĞI

- `app/dashboard/site/[siteId]/page.tsx` → `meta.title`, `meta.description` kullanıyor
- Sözlükte sadece `public.meta.title`, `public.meta.description` var
- **Çözüm:** `meta.title` → `public.meta.title` (veya meta.* alias ekle)

---

## 5. intent.whatsapp YANLIŞ KULLANIMI

- `lib/i18n/mapping.ts` → `t('intent.whatsapp')` kullanıyor
- Sözlükte `intent.whatsapp` yok; `event.whatsapp` ve `hunter.intentWhatsApp` var
- **Çözüm:** `event.whatsapp` veya `hunter.intentWhatsApp` kullan

---

## 6. ÖZET — DÜZELTİLMESİ GEREKENLER

| # | Tür | Adet |
|---|-----|------|
| Eksik anahtarlar | table.*, technical.*, meta.*, setup.*, intent.whatsapp | 12 |
| Hardcoded strings | Error mesajları | 3 |
| API string karşılaştırması | inviteSuccess | 1 |
| Namespace tutarsızlığı | meta vs public.meta | 1 |

**Toplam:** ~17 i18n sorunu
