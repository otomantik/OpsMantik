# PHASE 1 — “MÜHÜR PAKETİ” (Stamp Package)

**Scope:** Stop the bleed & capture truth (no UI polish)  
**Goal:** tel/whatsapp clicks MUST create click-intents in `calls` regardless of event_category rewrites, with idempotency.

---

## Stamp format (client)

**Field:** `meta.intent_stamp`  
**Format:**

```
${ts_ms}-${rand4}-${actionShort}-${targetHash6}
```

- `ts_ms`: `Date.now()`
- `rand4`: 4 chars base36 random
- `actionShort`: `tel` or `wa`
- `targetHash6`: 6 chars base36 hash of `target.href` lowercased

**Additional fields:**
- `meta.intent_action`: normalized action name (`phone_call` / `whatsapp`)

---

## Canonical storage (Phase 1.1)

**DB storage (`calls.intent_action`) is canonicalized to only:**
- `phone`
- `whatsapp`

Alias sets are used **only for detection** at ingest time.

---

## Target normalization (Phase 1.1)

### tel:

Canonical target format:
- `tel:+<digits>` (example: `tel:+905321796834`)

### WhatsApp:

Preferred (phone extracted):
- `wa:+<digits>` (example: `wa:+905321796834`)

Fallback (no phone extractable):
- `wa:<host>/<path>` (protocol stripped)

Extraction rules (best-effort):
- `web.whatsapp.com/send?phone=...` → `wa:+<digits>`
- `whatsapp.com/send?phone=...` → `wa:+<digits>`
- `wa.me/<digits>` → `wa:+<digits>`

---

## Server idempotency rules

### Preferred (DB-level)

- Store in `calls.intent_stamp` (nullable)
- Enforce **UNIQUE**:
  - `(site_id, intent_stamp)` WHERE `intent_stamp IS NOT NULL`
- Insert using conflict-ignore semantics:
  - duplicate stamp → no new row

### Fallback (no stamp)

Dedup within **10 seconds** by:
- `site_id`
- `matched_session_id`
- `intent_action`
- `intent_target` (normalized)

**Important:** action is part of key, so phone and whatsapp do not eat each other.

---

## Server fallback stamp guarantee (Phase 1.1)

If `meta.intent_stamp` is missing/empty, the server generates and stores one:

```
${Date.now()}-${rand4}-${intent_action}-${hash6(intent_target)}
```

Stored in `calls.intent_stamp` and truncated to max 128 chars.

---

## Intent gate decoupling (/api/sync)

Create/ensure click-intent when:
- session exists
- fingerprint exists **or** session_id exists
- `intent_action` is in alias sets OR legacy heuristics match

Alias sets:
- `PHONE_ACTIONS = ['phone_call','phone_click','call_click','tel_click']`
- `WHATSAPP_ACTIONS = ['whatsapp','whatsapp_click','wa_click']`

---

## Acceptance SQL (copy/paste)

### Prove column + index exists

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='calls'
  AND column_name IN ('intent_stamp','intent_action','intent_target')
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='calls'
  AND indexname IN ('idx_calls_site_intent_stamp_uniq','idx_calls_intent_fallback_dedupe');
```

### Prove idempotency (same stamp twice => 1 row)

```sql
-- Replace SITE_ID and STAMP
SELECT COUNT(*) FROM public.calls
WHERE site_id='<SITE_ID>' AND intent_stamp='<STAMP>';
```

---

## Manual test steps

1) Open a page with tel: and WhatsApp links, enable debug:
   - `localStorage.setItem('opsmantik_debug','1')`
2) Click tel and whatsapp.
3) In DevTools Network:
   - confirm `/api/sync` POST requests succeed.
4) Query DB by stamp (from console logs):
   - `SELECT * FROM public.calls WHERE intent_stamp='<STAMP>' ORDER BY created_at DESC;`

---

