# OCI queue — SRE follow-up (jitter, ACK_FAILED, DLQ report)

## Retry jitter

- **Env:** `OCI_RETRY_JITTER_MAX_SECONDS` — extra delay uniform in `0..N` seconds on top of exponential backoff base (`min(5m · 2^n, 24h)`). Default `60`; set `0` for deterministic tests or to disable jitter; capped at `600`.
- **Where it applies:** offline conversion worker ([lib/cron/process-offline-conversions.ts](../../lib/cron/process-offline-conversions.ts)), batch kernel retries ([lib/oci/runner/process-conversion-batch-kernel.ts](../../lib/oci/runner/process-conversion-batch-kernel.ts)), and TRANSIENT **ACK_FAILED** seal retries ([app/api/oci/ack-failed/route.ts](../../app/api/oci/ack-failed/route.ts)) using max `attempt_count` in the retry batch for one shared `next_retry_at`.

## DLQ autopsy (read-only)

From repo root with `.env.local` containing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`:

```bash
npm run oci:dlq-autopsy
npm run oci:dlq-autopsy -- --json
npm run oci:dlq-autopsy -- --site=<uuid|public_id|name-or-domain-fragment>
```

Samples up to 8000 terminal rows (`FAILED`, `DEAD_LETTER_QUARANTINE`), groups by `provider_error_code`, prints counts and a short sample `last_error`. Does not modify data.

## Poison pill

Invalid queue rows that fail mapping are quarantined by the kernel (`DEAD_LETTER_QUARANTINE` / audit), not left retrying indefinitely — see [OCI_QUEUE_HEALTH.md](../architecture/OCI_QUEUE_HEALTH.md) and kernel implementation.

## Won pipeline (`WON_MISSING_PIPELINE`) — teşhis ve onarım

Queue health, **won/sealed** çağrıların kuyrukta “koruyucu” statülerde görünmesini ister (kontrat). Script modu (`oci_sync_method: script`) site bazında aynıdır; eksik sayım **Google script’inin çalışmaması**ndan değil, çoğunlukla **kuyruk hiç oluşmaması** veya **`no_click_id`** yüzünden enqueue’ın kasıtlı reddinden kaynaklanır — Google Ads OCI tıklama kimliği olmadan zaten gönderilemez.

```bash
npm run oci:diagnose-won-missing -- --site=<filtre>    # read-only: eksik call_id + kuyruk satırları
npm run oci:repair-enqueue-won-calls -- --site=<filtre>  # dry-run (yazmaz)
npm run oci:repair-enqueue-won-calls -- --site=<filtre> --apply
```

`--apply`, `enqueueSealConversion` ile dener. **Tıklama yok:** satır yine de oluşturulur: **`BLOCKED_PRECEDING_SIGNALS` + `block_reason: MISSING_CLICK_ID`** — `WON_MISSING_PIPELINE` gider, Google export script tarafında yine gönderilmez (`claim` bu statüyü almaz). Tıklama sonradan bağlanınca satır güncellenene veya operasyonel yükseltme yapılana kadar **`promote-blocked-queue`** bu satırları **QUEUED yapmaz** (tıklama yokken yükseltme yok).
