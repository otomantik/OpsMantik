# Sync: Rate Limit, Quota & Batch — Pürüzsüz Varsayılanlar

Sistem artık varsayılan olarak rate limit ve kota ile **takılmadan** çalışacak şekilde ayarlandı. Ayrıca **batch** desteklendiği için 400 `batch_not_supported` hatası kalktı; tek istekte birden fazla event gönderilebilir (429 riski azalır).

- **400 batch_not_supported** → Artık yok. API `{ events: [e1, e2, ...] }` formatını kabul ediyor (en fazla 50 event/istek).

---

## 1) Rate limit (sync 429)

| Önceki | Yeni |
|--------|------|
| 500/dk (sabit) | **2000/dk** varsayılan |

- **OPSMANTIK_SYNC_RL_DEFAULT**: Tüm siteler için varsayılan limit (örn. `5000`). Tanımlı değilse 2000 kullanılır.
- **OPSMANTIK_SYNC_RL_SITE_OVERRIDE**: Belirli site için limit, örn. `70dc48806cb44740bf60778a7427f418:5000,b3e9634575df45c390d99d2623ddcde5:5000`.

Artık **ek env tanımlamadan** normal trafik 429’a takılmamalı. Gerekirse yalnızca tek site için override ekleyin.

---

## 2) Entitlements (aylık revenue_events limiti)

| Önceki | Yeni |
|--------|------|
| `OPSMANTIK_ENTITLEMENTS_FULL_ACCESS=true` gerekebiliyordu | **Production’da varsayılan full access** |

- **NODE_ENV=production** iken sync, aylık `monthly_revenue_events` limitine takılmaz (sınırsız kabul edilir).
- Subscription / tier’a göre kısıtlamak isterseniz: **OPSMANTIK_ENTITLEMENTS_STRICT=true** tanımlayın; DB’deki `get_entitlements_for_site` ve limitler uygulanır.
- **OPSMANTIK_ENTITLEMENTS_FULL_ACCESS=true**: Eski davranış; her ortamda full access (hâlâ destekleniyor).

Özet: Prod’da **hiçbir env eklemeden** kimse entitlements kotası yüzünden 429 almamalı.

---

## 3) Quota (site_plans — aylık limit)

| Önceki | Yeni |
|--------|------|
| Plan satırı yoksa `monthly_limit: 1000` | **Plan satırı yoksa `monthly_limit: 100_000`**, `soft_limit_enabled: true` |

`site_plans` tablosunda satırı olmayan siteler artık yüksek varsayılan limit ile çalışır; günlük kullanımda 429 beklenmez.

---

## 4) Özet env (isteğe bağlı)

| Değişken | Amaç |
|----------|------|
| `OPSMANTIK_SYNC_RL_DEFAULT` | Global varsayılan rate limit (örn. 5000). |
| `OPSMANTIK_SYNC_RL_SITE_OVERRIDE` | Site bazlı limit (public_id:limit, virgülle ayrılmış). |
| `OPSMANTIK_ENTITLEMENTS_STRICT` | Prod’da DB subscription limitlerini zorla (varsayılan: kapalı). |
| `OPSMANTIK_ENTITLEMENTS_FULL_ACCESS` | Her ortamda full access (eski davranış). |

**Hiçbiri tanımlı olmasa bile** production’da sync ve canlı kuyruk akışı pürüzsüz çalışmalıdır.

---

## 5) Hâlâ 429 / boş kuyruk görürseniz

1. **Sync 429** → Response header: `x-opsmantik-ratelimit` (rate limit) vs `x-opsmantik-quota-exceeded` (kota).
2. **Rate limit** → `OPSMANTIK_SYNC_RL_DEFAULT` veya `OPSMANTIK_SYNC_RL_SITE_OVERRIDE` ile limiti artırın.
3. **Kota** → `OPSMANTIK_ENTITLEMENTS_STRICT=true` kullanıyorsanız subscription/limitleri kontrol edin; kullanmıyorsanız bu kod yolu prod’da kapalı.
4. **Kuyruk boş, valid_sessions = 0** → Sync’in 200 döndüğünü ve sync worker’ın çalıştığını doğrulayın (event’ler session’ları güncellemeli).
