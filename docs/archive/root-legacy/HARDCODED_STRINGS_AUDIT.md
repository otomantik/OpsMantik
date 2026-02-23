# Hardcoded Strings Audit — "Hardcoded Killer" Report

**Scope:** `components/dashboard`, `app/dashboard`, related hooks  
**Scope excludes:** Login, Admin, test pages  
**Date:** Generated for i18n / maintainability cleanup

---

## Özet

| Kategori | Dosya sayısı | Tahmini hardcoded satır | Öncelik |
|----------|--------------|-------------------------|---------|
| KPI & Cards | 2 | ~25 | P0 |
| Activity Log | 2 | ~20 | P0 |
| Traffic & Breakdown | 2 | ~35 | P0 |
| Sites & Setup | 3 | ~50 | P1 |
| Session Drawer & Cards | 5 | ~45 | P1 |
| Hunter Card | 1 | ~15 | P0 |
| Queue | 3 | ~15 | P0 |
| Diğer | 4 | ~20 | P1 |
| **Toplam** | **~22** | **~225** | |

---

## 1) KPI Cards (`kpi-cards-v2.tsx`)

| Satır | Metin | Tür | Öneri |
|-------|-------|-----|-------|
| 96 | `Ads Sessions` | KPI başlık | `kpi.adsSessions` |
| 104 | `Refresh KPIs` | title | `button.refreshKpis` |
| 114 | `Today (TRT)` | Alt etiket | `kpi.todayTrt` |
| 122 | `Phone Intents` | KPI başlık | `kpi.phoneIntents` |
| 132 | `Clicks` | Alt etiket | `kpi.clicks` |
| 140 | `WhatsApp Intents` | KPI başlık | `kpi.whatsappIntents` |
| 150 | `Clicks` | Alt etiket | `kpi.clicks` |
| 158 | `Forms` | KPI başlık | `kpi.forms` |
| 166 | `Hidden` | Durum | `kpi.hidden` |
| 168 | `Conversions` | Alt etiket | `kpi.conversions` |

---

## 2) Activity Log (`activity-log-shell.tsx`)

| Satır | Metin | Tür | Öneri |
|-------|-------|-----|-------|
| 164 | `OpsMantik` | Fallback site adı | `brand.fallbackSiteName` veya sabit |
| 174 | `Hours` | Filtre etiket | `activity.hours` |
| 188 | `Action` | Filtre etiket | `activity.action` |
| 195-199 | `ALL`, `SEAL`, `JUNK`, `CANCEL`, `RESTORE`, `UNDO` | Select options | `activity.filterAll` vb. |
| 210 | `Only undoable` | Checkbox | `activity.onlyUndoable` |
| 220 | `Refresh` | Button | `button.refresh` |
| 229 | `Recent actions` | Başlık | `activity.recentActions` |
| 230 | `rows` | Çoğul | `activity.rows` |
| 240 | `Loading…` | Durum | `misc.loading` |
| 242 | `No actions in this window.` | Empty state | `activity.noActionsInWindow` |
| 300 | `Undo` | Button | `activity.undo` |
| 296-297 | `Undo last action` | title/aria-label | `activity.undoTitle` |
| 114 | `Failed to load activity log` | Hata | `activity.failedToLoad` |

---

## 3) Activity Log Inline (`activity-log-inline.tsx`)

| Satır | Metin | Tür | Öneri |
|-------|-------|-----|-------|
| 44 | `No actions yet.` | Empty state | `activity.noActionsYet` |
| 84 | `Undo last action` | title | `activity.undoTitle` |
| 95 | `Cancel deal` | title | `activity.cancelDealTitle` |

---

## 4) Traffic Source Breakdown (`traffic-source-breakdown.tsx`)

| Satır | Metin | Tür | Öneri |
|-------|-------|-----|-------|
| 44-67 | `Google Ads`, `SEO`, `Social`, `Direct`, `Referral`, `Other` | Bucket labels (veri) | config / i18n bucket names |
| 77-79 | `Organic (SEO) is driving...` | Insight metni | `traffic.insightOrganic` (dinamik AI insight — i18n dışı kalabilir) |
| 133 | `No sessions in this range.` | Empty state | `traffic.noSessionsInRange` |
| 149 | `Insight:` | Label | `traffic.insightLabel` |
| 216 | `Total` | Label | `traffic.total` |

---

## 5) Sites Manager (`sites-manager.tsx`)

| Satır | Metin | Tür | Öneri |
|-------|-------|-----|-------|
| 275 | `Loading sites...` | Loading | `sites.loading` |
| 286 | `Sites` | Başlık | `sites.title` |
| 291 | `Database Schema Mismatch` | Hata başlık | `sites.schemaMismatch` |
| 297-301 | `To fix this:`, migration talimatları | Yardım metni | `sites.fixSchemaHelp` |
| 315 | `Sites` | Başlık | `sites.title` |
| 317 | `Manage your tracking sites` | Açıklama | `sites.manageDescription` |
| 325 | `✕ Cancel` / `+ Add Site` | Button | `button.cancel`, `sites.addSite` |
| 333 | `Error loading sites` | Hata | `sites.errorLoading` |
| 339 | `Check browser console...` | Yardım | `sites.checkConsole` |
| 348-349 | `Site Name *`, `Domain *` | Form label | `sites.siteName`, `sites.domain` |
| 357 | `My Website` | placeholder | `sites.siteNamePlaceholder` |
| 371 | `example.com` | placeholder | `sites.domainPlaceholder` |
| 375 | `Protocol and path will be stripped...` | Yardım | `sites.domainHelp` |
| 388 | `⏳ Creating...` / `🚀 Create Site` | Button | `sites.creating`, `sites.createSite` |
| 395 | `Site created successfully!` | Başarı | `sites.createdSuccess` |
| 399-406 | `Warning:`, `NEXT_PUBLIC_PRIMARY_DOMAIN...` | Uyarı | `sites.warningPrimaryDomain` |
| 412 | `Install Snippet:` | Label | `sites.installSnippet` |
| 422 | `✓ Copied` / `📋 Copy` | Button | `sites.copied`, `button.copy` |
| 428-429 | `No sites yet`, `Add your first site...` | Empty state | `sites.noSites`, `sites.addFirstSite` |
| 443 | `Unnamed Site` | Fallback | `sites.unnamedSite` |
| 514+ | `Install Snippet`, `Login URL:`, vb. | Çeşitli | `sites.*` |

---

## 6) Site Setup & Switcher (`site-setup.tsx`, `site-switcher.tsx`)

| Dosya | Metin | Öneri |
|-------|-------|-------|
| site-setup | `No sites found`, `Test Site Details:`, `localhost:3000`, `Error:`, `Test site created! Reloading...` | `setup.*` |
| site-switcher | `Sites`, `Loading sites...` | `sites.*` |

---

## 7) Session Drawer & Cards

| Dosya | Örnek Metinler | Öneri |
|-------|----------------|-------|
| lazy-session-drawer | `Loading session…`, `Created`, `Device`, `Location`, `Attribution`, `No events` | `session.*` |
| session-drawer | `Intent`, `Type`, `Time`, `Matched session`, `No matched session found`, `Session ID:`, `IP:`, `User Agent:`, `Duration:`, `Created:`, `Events:` | `session.*` |
| session-card-expanded | `Time`, `Category`, `Action`, `Label`, `Value`, `URL`, `Score:`, `Match Time:` | `session.*` |
| session-card-header | `HOT LEAD`, `Source:`, `GCLID:`, `Returning`, `Sessions 24h:`, `History`, `Copy Session ID`, `View visitor history` | `session.*` |

---

## 8) Hunter Card (`hunter-card.tsx`)

| Satır | Metin | Tür | Öneri |
|-------|-------|-----|-------|
| 60-76 | `Device`, `Desktop`, `Tablet`, `Mobile`, `iPhone`, `Android`, `MacBook`, `Windows`, `Unknown` | Device/OS labels | `hunter.deviceDesktop` vb. |
| 112-127 | `SEO`, `Google Ads`, `Social`, `Direct` | Source labels | `hunter.sourceSeo` vb. (veya mevcut) |
| 237 | `WhatsApp Direct`, `Phone Inquiry`, `Lead Form`, `General Intent` | Intent type | `hunter.intentWhatsApp` vb. |
| 257 | `Session Actions` | Label | `hunter.sessionActions` |
| 279, 296 | `Read-only role`, `Mark as junk`, `Seal lead` | title | `hunter.readOnlyRole`, `hunter.markJunk`, `hunter.sealLead` |
| 154-156 | `Mute` / `Unmute`, `star` | seal-modal | `seal.mute`, `seal.unmute`, `seal.starLabel` |

---

## 9) Queue (`queue-deck.tsx`, `queue-states.tsx`)

| Dosya | Metin | Öneri |
|-------|-------|-------|
| queue-deck | `Loading details…` | `queue.loadingDetails` |

---

## 10) CRO & Diğer Widgets

| Dosya | Metin | Öneri |
|-------|-------|-------|
| cro-insights | `💡 Suggestion: Enable Sticky Call Button at {peakHourStr} for max CRO.`, `Based on {n} recent intent events.` | `cro.suggestionSticky`, `cro.basedOnEvents` |
| dashboard-header-v2 | `Live`, `Offline` | `status.live`, `status.offline` |
| intent-card | `Who`, `Where`, `Campaign`, `Keyword`, `Page`, `Why High Risk?`, `Lead quality` | `intent.*` |
| visitor-history-drawer | `Visitor History`, `Loading visitor history...`, `No previous sessions found...`, `Other Calls (Same Fingerprint)` | `visitor.*` |

---

## 11) title / aria-label / placeholder (Erişilebilirlik)

| Dosya | Key | Mevcut | Öneri |
|-------|-----|--------|-------|
| seal-modal | title/aria | `Unmute`, `Mute` | `seal.unmute`, `seal.mute` |
| seal-modal | aria | `{star} star` | `seal.starAria` |
| hunter-card | title | `Read-only role`, `Mark as junk`, `Seal lead` | t() |
| breakdown-widget | title | `getDimensionLabel(dim)` | Zaten t() kullanıyor olabilir |
| intent-card | aria | `Dismiss error` | `aria.dismissError` |
| intent-card | title | `Open session details` | `intent.openSessionDetails` |

---

## Önerilen Yeni Message Keys (Öncelik Sırası)

### P0 — Dashboard i18n sprint kapsamında

```
kpi.adsSessions, kpi.phoneIntents, kpi.whatsappIntents, kpi.forms
kpi.clicks, kpi.conversions, kpi.todayTrt, kpi.hidden
button.refreshKpis
activity.hours, activity.action, activity.recentActions, activity.rows
activity.onlyUndoable, activity.noActionsInWindow, activity.noActionsYet
activity.undo, activity.undoTitle, activity.cancelDealTitle, activity.failedToLoad
activity.filterAll, activity.filterSeal, activity.filterJunk, activity.filterCancel, activity.filterRestore, activity.filterUndo
traffic.noSessionsInRange, traffic.insightLabel, traffic.total
hunter.deviceDesktop, hunter.deviceTablet, hunter.deviceMobile
hunter.intentWhatsApp, hunter.intentPhone, hunter.intentForm, hunter.intentGeneral
hunter.readOnlyRole, hunter.markJunk, hunter.sealLead
queue.loadingDetails
status.live, status.offline
```

### P1 — Sites, Session, Visitor (genişletilmiş sprint)

```
sites.*, setup.*, session.*, visitor.*, intent.*, cro.*
```

---

## İstatistik

- **Toplam hardcoded string (tahmini):** ~225
- **t() ile çevrilmiş:** ~80 (mevcut i18n sprint)
- **Kalan:** ~145
- **P0 (yüksek görünürlük):** ~60
- **P1 (orta görünürlük):** ~85

---

## Sonuç

1. **KPI Cards:** Ads Sessions, Phone Intents, WhatsApp Intents, Forms, Clicks, Conversions, Today (TRT), Hidden — hepsi hardcoded.
2. **Activity Log:** Hours, Action, filtre seçenekleri, Empty states, Undo — hepsi hardcoded.
3. **Traffic:** Bucket adları (Google Ads, Social vb.) veri mapping'de; UI etiketleri (Total, Insight, No sessions) hardcoded.
4. **Sites Manager:** Neredeyse tüm UI metinleri hardcoded.
5. **Session / Hunter / Intent:** Yoğun hardcoded etiket ve başlıklar.

**Öneri:** Önce P0 key'leri eklenip `t()` ile değiştirilsin; ardından P1 (sites, session, visitor) sprint'e alınsın.
