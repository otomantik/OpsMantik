# 🚨 CRITICAL: Database Migrations Not Applied

## Problem
The following RPCs are returning **404** because migrations haven't been applied to production:
- `get_recent_intents_v1` (404)
- `get_session_details` (404) 
- `get_session_timeline` (404)

Also, `get_dashboard_stats` and `get_dashboard_timeline` are returning **500** - likely because dependencies like `is_ads_session` aren't applied.

## Solution: Push Migrations

### Step 1: Verify Supabase Link
```powershell
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1
supabase link --project-ref jktpvfbmuoqrtuwbjpwl
```

If already linked, skip this step.

### Step 2: Push All Migrations
```powershell
supabase db push
```

This will apply all pending migrations in `supabase/migrations/` to production.

### Step 3: Verify RPCs Exist
After push, verify in Supabase Dashboard SQL Editor:
```sql
-- Check if RPCs exist
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN (
    'get_recent_intents_v1',
    'get_session_details', 
    'get_session_timeline',
    'is_ads_session',
    'get_dashboard_stats',
    'get_dashboard_timeline'
  )
ORDER BY routine_name;
```

Expected: All 6 functions should appear.

## Critical Migrations to Apply

These migrations must be applied in order:
1. `20260128030000_ads_session_predicate.sql` - Creates `is_ads_session()`
2. `20260128031100_fix_is_ads_session_input_signature.sql` - Fixes `is_ads_session()` signature
3. `20260128024000_dashboard_session_rpcs.sql` - Creates `get_session_details()`
4. `20260128038000_calls_inbox_fields.sql` - Adds `intent_page_url` and `click_id` columns
5. `20260128038100_rpc_get_recent_intents_v1.sql` - Creates `get_recent_intents_v1()`
6. `20260128038200_rpc_get_session_timeline.sql` - Creates `get_session_timeline()`
7. `20260128038300_rpc_get_recent_intents_v1_coalesce_fields.sql` - Updates `get_recent_intents_v1()` with COALESCE

## After Migration Push

1. **Hard refresh** the dashboard (Ctrl+Shift+R)
2. **Check Network tab** - 404s should disappear
3. **Check Console** - Errors should reduce significantly

## React Hydration Error (#418)

The hydration error may be secondary to the 404s. After fixing migrations:
- If hydration error persists, it's likely in `live-inbox.tsx` due to:
  - `formatTimestamp()` timezone differences
  - `rows.length` dynamic content
  - URL parsing with `new URL()`

We'll address hydration after migrations are applied.
