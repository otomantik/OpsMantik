# Install Center V1 — acceptance criteria (SEAL-00)

**Target route:** `/panel/sites/[siteId]/install` or `?view=install` (PR-OM-SEAL-07)  
**APIs today:** `GET /api/sites/[siteId]/tracker-embed`, `POST .../origins/verify`

## Per-site page must show

- [ ] Copy-paste tracker snippet (from tracker-embed)
- [ ] WordPress installation steps
- [ ] Shared hosting (cPanel / FTP) steps
- [ ] Optional SST note (server-side tagging pointer)
- [ ] Origin verification CTA + result
- [ ] Heartbeat / last sync timestamp
- [ ] Latest `core.js` script version
- [ ] Test event button (safe, site-scoped)
- [ ] Phone click detector status (24h)
- [ ] WhatsApp detector status (24h)
- [ ] Form detector status (24h)
- [ ] Conversion readiness summary (click-id + consent + events)

## Status machine

```txt
not_installed
→ installed_no_events
→ events_received
→ intent_events_received
→ conversion_ready
→ broken_no_heartbeat
→ origin_mismatch
→ consent_missing
→ outdated_script
```

| State | Entry condition | Operator action |
|-------|-----------------|-----------------|
| `not_installed` | No events 24h | Paste snippet, verify origin |
| `installed_no_events` | Snippet copied, no events | Wait / test event |
| `events_received` | Generic sync events | Trigger phone/WA/form test |
| `intent_events_received` | Intent-class event seen | Open panel desk |
| `conversion_ready` | Intent + origin verified + marketing consent | Normal ops |
| `broken_no_heartbeat` | No sync > N hours | Check DNS, adblock, snippet |
| `origin_mismatch` | Origin verify failed | Fix allowed origins |
| `consent_missing` | No marketing consent scope | Fix CMP / consent API |
| `outdated_script` | Script version < fleet minimum | Re-copy embed |

## Acceptance

- Each state has UI copy + single primary action.
- `conversion_ready` requires: events + ≥1 intent event + origin verified + consent scope for ads identifiers.
- No spend/funnel/CRO widgets on this page.

## Evidence (existing)

- Embed: [`app/api/sites/[siteId]/tracker-embed/route.ts`](../../../app/api/sites/[siteId]/tracker-embed/route.ts)
- Origins: [`app/api/sites/[siteId]/origins/verify/route.ts`](../../../app/api/sites/[siteId]/origins/verify/route.ts)
- Universal tracker: [`public/assets/core.js`](../../../public/assets/core.js)
