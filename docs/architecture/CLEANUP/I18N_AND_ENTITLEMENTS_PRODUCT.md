# i18n and entitlements — product decision (placeholder)

## i18n

- Dictionaries live under `lib/i18n/messages/`.
- **Decision pending:** single operator locale vs full `en/tr/it` matrix. Slimming locales reduces `verify:i18n*` CI time.

## Entitlements / billing

- Code: `lib/entitlements`, `lib/billing`, env `OPSMANTIK_ENTITLEMENTS_FULL_ACCESS`.
- **Decision pending:** for “offline conversion only” customers, choose one:
  1. Keep APIs, hide UI controls.
  2. Hard-disable non-OCI modules per site tier (requires data model + tests).

Record the decision here when product signs off.
