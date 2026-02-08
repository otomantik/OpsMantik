# Alerting — Webhook (Slack / Generic) + Telegram

This project can deliver alarms via:
- **Telegram** (existing)
- **Webhook** (new): Slack Incoming Webhook or any generic JSON receiver

Primary producer: `WatchtowerService.notify()` (triggered when `status = "alarm"`).

## Webhook configuration (recommended)

Set these environment variables in production:

- **`ALERT_WEBHOOK_URL`**: target webhook URL  
  - Slack: `https://hooks.slack.com/services/...`
  - Generic: your endpoint URL

- **`ALERT_WEBHOOK_KIND`** *(optional)*: `slack` | `generic`  
  - Default: `generic`  
  - Auto-detects `slack` when URL contains `hooks.slack.com`

- **`ALERT_WEBHOOK_TIMEOUT_MS`** *(optional)*: request timeout (default `5000`)

### Payloads

#### Slack (`ALERT_WEBHOOK_KIND=slack`)

We POST:

```json
{ "text": "<message>" }
```

#### Generic (`ALERT_WEBHOOK_KIND=generic`)

We POST:

```json
{
  "service": "watchtower",
  "level": "alarm",
  "message": "<message>",
  "health": { "...": "WatchtowerHealth" }
}
```

## Fail-closed behavior

- If webhook delivery fails (timeout / non-2xx / network), we:
  - Keep the system in **alarm** state (no silent success)
  - Emit **structured errors** to logs (`logError`)
  - Still attempt Telegram (best-effort)

## PII safety

Outbound webhook messages run through a best-effort sanitizer to redact:
- emails
- phone-like sequences
- bearer tokens

Current Watchtower payload is non-PII, but sanitizer is defensive.

## Telegram configuration (existing)

Set:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

If missing in production, Telegram service logs a critical error and returns `false`.

## Quick verification (production)

Trigger Watchtower (authorized):

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://console.opsmantik.com/api/cron/watchtower"
```

Proof checklist:
- Response JSON has `status: "ok" | "alarm"`
- If `alarm`, you see `watchtower alarm` / webhook error logs when webhook fails
- Webhook receiver receives a POST within timeout

