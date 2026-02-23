# Device labeling improvement — proof

## A) DB

**Migration:** `supabase/migrations/20260130250800_sessions_device_os.sql`

- `sessions.device_os` TEXT nullable. No device_brand/device_model (skipped).

```sql
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS device_os TEXT;
```

## B) Sync

**File:** `app/api/sync/route.ts` — OS from `deviceInfo.os` (UAParser), persisted as `device_os: deviceInfo.os || null` on insert/update. Already implemented.

## C) RPC

**Migration:** `supabase/migrations/20260130250900_intents_v2_device_os.sql` — `get_recent_intents_v2` returns `device_os`. Already implemented.

## D) HunterCard diff hunks

**HunterCard.tsx:** `deviceLabel(deviceType, deviceOs?)` returns label `${typeLabel}` + (os ? ` · ${os}` : ''). Examples: "Mobile · iOS", "Desktop · Windows". Pass `intent.device_os` into `deviceLabel`.

**QualificationQueue.tsx:** Map `device_type: r.device_type ?? null` from RPC so deck cards get device_type.

## SQL proof

```sql
SELECT id, device_type, device_os FROM public.sessions WHERE device_os IS NOT NULL ORDER BY created_at DESC LIMIT 5;
```

## Smoke

**Script:** `scripts/smoke/device-os-proof.mjs` — Run: `npm run smoke:device-os`. Inserts session with device_type + device_os, selects and asserts. Output: PASS.
