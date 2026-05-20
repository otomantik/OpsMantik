# SEAL-04A — Install Center V1

## Route

- **Primary:** `/panel/sites/[siteId]/install`
- **Alias (optional):** `/panel?view=install&siteId=<uuid>` → redirects to primary

## Scope

Read-heavy operator surface:

- Tracker snippet (proxy mode via `GET /api/sites/[siteId]/tracker-embed?mode=proxy`)
- Install instructions (HTML, WordPress, shared hosting, SST note)
- Site health (origins, last event/heartbeat, readiness badge)
- Navigation back to `/panel` and `/panel/oci`

## Non-goals (V1)

- Mail center, reporting SSOT, premium polish
- Stage/seal mutations
- OCI export/ACK/script changes
- `core.js` / Universal script edits
- Migrations / cron changes

## Readiness states

See `lib/panel/install-status.ts`. States such as `consent_missing`, `script_outdated`, and live script detection are **future** when telemetry is exposed; they may map to `unknown` today.

## Auth

Same as panel: `validateSiteAccess` + authenticated session. Snippet endpoint never renders `data-ops-secret` in the Install Center UI.
