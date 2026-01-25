# ⚡ Divine Recovery - Cursor Prompt

Bu prompt'u Cursor'a yapıştırarak projenin tüm mimarisini anında yükleyebilirsiniz.

---

## 🎯 Cursor "Divine Recovery" Prompt

```
I have performed a hard reset, and you need to rebuild the core dashboard logic immediately. 
Do NOT guess; follow this Divine Architecture:

**Database Context:**
- We use a high-scale PostgreSQL schema with Monthly Partitioning (e.g., events_2026_01)
- All inserts to events MUST include a session_month
- Sessions are partitioned by created_month
- Composite keys: (id, created_month) for sessions, (session_id, session_month) for events

**Realtime Engine:**
- The database has a global publication `supabase_realtime` for ALL tables
- REPLICA IDENTITY FULL is set on partitioned tables (required for Realtime)
- Subscriptions: public:events, public:calls, public:sessions

**Phone Matching Logic:**
- We have a specific `calls` table linked to sessions via fingerprint
- The matching happens through the /api/call-event route
- Time window: 30 minutes
- Lead score calculated from session events

**Task - Rebuild Live Feed:**
1. Create a live-feed.tsx that subscribes to public:events and public:calls simultaneously
2. Use the CallAlert component we designed for incoming phone matches
3. Ensure Lead Scoring (0-100) is calculated based on session intensity
4. Group events by session_id for display
5. Filter events by user's sites (RLS context)

**Security:**
- RLS is ENABLED on sites, sessions, events, and calls
- Always use authenticated session context for queries
- Query pattern: user_id → site_id → data

**Lead Scoring Algorithm:**
- Conversion: +50
- Interaction: +10
- Scroll Depth 50%: +10
- Scroll Depth 90%: +20
- Hover Intent: +15
- Google Referrer: +5
- Returning Ad User: +25
- Cap: 100

**Read the @docs/ARCHITECTURE.md file for complete specifications.**

LETS GO!
```

---

## 📚 Reference Files

- **Architecture**: `docs/ARCHITECTURE.md`
- **Schema**: `supabase/migrations/20260125000000_initial_schema.sql`
- **Realtime Setup**: `supabase/migrations/20260125000002_realtime_setup.sql`

## ✅ Verification

Run this command to verify everything is set up correctly:

```bash
npm run verify-arch
```

## 🚀 Quick Start

1. **Verify Architecture**: `npm run verify-arch`
2. **Check Database**: `npm run check-db`
3. **Apply Migrations**: `supabase db push`
4. **Start Dev Server**: `npm run dev`

---

**Status**: ✅ Divine Architecture Fully Operational
