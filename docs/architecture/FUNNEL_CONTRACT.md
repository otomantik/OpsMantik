# Funnel Kernel Contract (FUNNEL_CONTRACT)

**OpsMantik Funnel Kernel Charter v1 — değişmez semantik**

Bu doküman kernel ontolojisini ve kırmızı çizgileri tanımlar. Uygulama bu kontrata göre geliştirilir.

> **Operational view:** [docs/operations/OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md)

---

## Stratejik Karar: V1 Kernel Dışı

| Katman | Kapsam | Açıklama |
| ------ | ------ | -------- |
| **Observability Layer** | V1 (PAGEVIEW) | Redis volume, visibility, traffic telemetry. call_id merkezli değil. |
| **Funnel Kernel** | V2–V5 | Revenue ontolojisi. call_id zorunlu. |

V1 kernel'e dahil edilmez. Pageview call_id'ye zorla bağlanmaz.

---

## Stage Semantiği

| Stage | İsim | Açıklama | Value |
| ----- | ---- | -------- | ----- |
| V2 | PULSE | İlk temas | AOV×2% soft decay |
| V3 | ENGAGE | Nitelikli temas | AOV×10% standard decay |
| V4 | INTENT | Sıcak niyet | AOV×30% aggressive decay |
| V5 | SEAL | Demir mühür | exact value_cents, no decay |

| Alan | Aralık |
| ---- | ------ |
| stage | V2, V3, V4, V5 |
| quality_score | 1..5 (esnaf puanı) |
| confidence | 0..1 (attribution güveni) |

---

## Event Type Sözlüğü (Canonical)

| event_type | Açıklama |
| ---------- | -------- |
| V2_CONTACT | Gerçek V2 temas |
| V2_SYNTHETIC | Repair ile tamamlanan V2 |
| V3_QUALIFIED | V3 nitelikli temas |
| V4_INTENT | V4 sıcak niyet |
| V5_SEALED | Mühürlenmiş satış |
| REPAIR_ATTEMPTED | Repair deneniyor |
| REPAIR_COMPLETED | Repair tamamlandı |
| REPAIR_FAILED | Repair başarısız |

---

## Funnel Kernel Kırmızı Çizgiler

| Kural | Açıklama |
| ----- | -------- |
| Route'lar projection'a doğrudan yazamaz | Sadece ledger-writer + projection-updater yazar |
| Export business truth projection dışı okumaz | USE_FUNNEL_PROJECTION=true sonrası tek kaynak projection |
| V5 completeness olmadan READY olamaz | funnel_completeness = complete zorunlu |
| Repair normal akış yerine geçemez | İstisna mekanizması; KPI ile izlenir |
| Synthetic stage'ler görünmez olamaz | v2_source, synthetic_flags_json projection'da |
| Policy dışı ad-hoc value hesabı yasak | Tek SSOT: value-config + policy |
| Legacy util'lerden yeni import yasak | mizan-mantik, predictive-engine deprecate |
| Reducer deterministik order dışına çıkamaz | ORDER BY sabit; değişmez |

---

## Tenant Güvenliği: site_id × call_id

Verilen `call_id`, verilen `site_id` ile eşleşmiyorsa event append fail olmalı. Append path'te `calls.site_id = site_id` doğrulaması zorunlu.

---

## İnvariant

V5 var ise projection'da `funnel_completeness = complete`; aksi halde repair worker veya BLOCKED.
