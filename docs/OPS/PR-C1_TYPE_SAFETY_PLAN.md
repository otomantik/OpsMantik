# PR-C1: Tip güvenliği planı (58 → 100)

**Hedef:** `any` / `as any` kullanımını kritik yollarda sıfıra indirmek; ortak tipleri tek yerde tanımlayıp API, lib ve UI’da kullanmak.

---

## Faz 1: Paylaşılan tipler (altyapı)

| Adım | İçerik |
|------|--------|
| 1.1 | **Sync:** `lib/types/ingest.ts` zaten var; sync route’da `body` zaten `ValidIngestPayload` — `(body as any).ec/.ea/.el` kaldır, `body.ec`, `body.ea`, `body.el` kullan. |
| 1.2 | **Call-event:** `lib/types/call-event.ts` — `ScoreBreakdown`, `EventMetadata` (lead_score), `CallRecord` (calls row), `insertError` için Supabase `PostgrestError`. |
| 1.3 | **OCI:** `lib/types/oci.ts` — `SiteWithCurrency`, `OciCallRow`, `OciSessionRow`; oci/export route’da kullan. |

---

## Faz 2: API route’ları (yüksek etki)

| Öncelik | Dosya | Yapılacak |
|--------|--------|-----------|
| 1 | `app/api/call-event/route.ts` | scoreBreakdown, callRecord, insertError, event metadata tipleri |
| 2 | `app/api/call-event/v2/route.ts` | Aynı call-event tipleri |
| 3 | `app/api/sync/route.ts` | Faz 1’de (body.ec/ea/el) |
| 4 | `app/api/oci/export/route.ts` | Site, call row, session row tipleri |
| 5 | `app/api/cron/reconcile-usage/route.ts` | `result: any` → RPC dönüş tipi |
| 6 | `app/api/cron/reconcile-usage/backfill/route.ts` | `catch (err: any)` → `unknown` + type guard |
| 7 | `app/api/stats/reconcile/route.ts` | `(s: any)`, `null as any` → doğru tip |
| 8 | `app/api/billing/dispute-export/route.ts` | `makeIterator() as any` → iterator generic |
| 9 | `app/api/watchtower/partition-drift/route.ts` | `(payload as any)?.ok` → payload interface |

---

## Faz 3: Lib / servisler

| Dosya | Yapılacak |
|--------|-----------|
| `lib/analytics/source-classifier.ts` | `params: any` → UTM/source interface |
| `lib/services/intent-service.ts` | `meta: any` → intent meta interface |
| `lib/supabase/admin.ts` | `(client as any)[prop]` → doğru tip veya gerekçeli @ts-expect-error |
| `lib/upstash.ts` | `const self: any` → Redis/client tipi |
| `lib/services/rate-limit-service.ts` | `redis as any` → Upstash Redis tipi |
| `lib/services/replay-cache-service.ts` | `redisClient: any` → Redis tipi |

---

## Faz 4: Hooks ve UI

| Öncelik | Dosya | Yapılacak |
|--------|--------|-----------|
| 1 | `components/dashboard/qualification-queue/parsers.ts` | Tek “queue row” / “intent row” tipi (53 kullanım) |
| 2 | `lib/hooks/use-queue-controller.ts` | Queue/intent tipleri |
| 3 | `lib/hooks/use-intents.ts`, `use-breakdown-data.ts`, `use-timeline-data.ts` | İlgili item tipleri |
| 4 | `components/dashboard/activity-log-shell.tsx`, `queue-deck.tsx`, `hunter-card.tsx` | Domain tipleri |

---

## Faz 5: Testler ve lint

- Test mock’larında mümkün olan yerde doğru tip; kalan `as any` kabul edilebilir.
- `@typescript-eslint/no-explicit-any`: warn ile aç; yeni `any` yazımını engelle.

---

## İlerleme

- [x] Plan dokümanı (bu dosya)
- [x] Faz 1: Paylaşılan tipler + sync, call-event, oci/export
  - `lib/types/call-event.ts` (ScoreBreakdown, EventMetadata, CallRecord, CallInsertError)
  - `lib/types/oci.ts` (SiteWithCurrency, OciCallRow, OciSessionRow)
  - sync: `body.ec` / `body.ea` / `body.el` (ValidIngestPayload)
  - call-event + v2: scoreBreakdown, callRecord, insertError, event metadata tipleri
  - oci/export: site, rows, sessionRows tipleri
- [x] Faz 2: Kalan API route’ları
  - reconcile-usage: ReconcileCronResponse, EnqueueResult, ProcessResult
  - reconcile-usage/backfill: catch (err: unknown)
  - stats/reconcile: session row type, drift.captured: number | null
  - dispute-export: ReadableStream from async generator (no as any)
  - watchtower/partition-drift: PartitionDriftPayload
- [x] Faz 3: Lib/servisler
  - source-classifier: ParamsObject (Record<string, unknown> | null | undefined), determineTrafficSource(params)
  - intent-service: meta: Record<string, unknown>, phone_number/wbraid/gbraid type guards
  - admin: Proxy get (client as unknown as Record<string | symbol, unknown>)
  - upstash: FailingPipeline type, makeFailingPipeline()
  - rate-limit-service: redisClient = redis (no as any)
  - replay-cache-service: redisClient: RedisLike | null = redis
- [x] Faz 4: Hooks/UI
  - parsers: RpcIntentRow interface, rowStr/rowNum/rowArr helpers
  - use-queue-controller: LegacyKillRow, ActivityFeedRpcRow, parseHunterIntentsFull([data]), filter as ActivityRow[]
  - use-intents: RpcIntentItem, transformed: IntentRow[]
  - use-breakdown-data: RpcBreakdownItem
  - use-timeline-data: RpcTimelinePoint
  - hunter types: traffic_source, traffic_medium on HunterIntent + HunterIntentLite
  - queue-deck, hunter-card: intent.traffic_source, intent.phone_clicks, theme.icon as React.ComponentType
  - activity-log-shell: ActivityLogRpcRow, setActionType union
  - session-group: CompressedEvent[], getPrevTime, EnrichedEvent cast
  - seal-modal: navigator as Navigator & { vibrate? }
- [x] Faz 5: Test + no-explicit-any
  - ESLint: `@typescript-eslint/no-explicit-any` = "warn"
  - Test TS fixes: financial-proofing (session null check), tenant-rls-proof (env cast), idempotency (payload as ValidIngestPayload), qstash/require-cron-auth (process.env NODE_ENV cast), watchtower-response (billingReconciliationDriftLast1h in mocks)
