# PROD MISMATCH / UI BREAKAGE REPORT (for Gemini)

**Date:** 2026-01-28  
**Route:** `/dashboard/site/[siteId]`  
**Symptom (prod):** Giant WhatsApp logo filling page + layout looks like CSS not applied + Queue shows “All Caught Up” even though DB has intents.  

---

## 1) What this symptom usually means (highest probability)

The “giant icon” + “no layout” combo is classic **stale / missing CSS**:
- The HTML renders, but the `/_next/static/css/...` or chunks are not the ones the page expects.
- Or a cached old bundle is still being used (browser cache / service worker / CDN caching).

Important: we implemented a **hard safety** fix: brand SVGs now have explicit `width/height=16`.  
If you still see a massive logo after deploy, it almost certainly means **the new code is not what prod is serving**.

---

## 2) Current local HEAD (authoritative)

Local HEAD commit:
- `67de4a2` — “prevent giant brand SVG + sync queue with inbox RPC”

If production does not reflect this, the mismatch is deployment/caching, not React code logic.

---

## 3) Root causes (ranked)

### RC-A (Most likely): The latest commit is not deployed to prod
Causes:
- CI/CD didn’t run
- Vercel build failed
- Wrong branch is deployed
- Manual deploy not triggered

### RC-B: Browser cache / Service Worker / PWA caching old assets
If there’s a service worker, it can pin old `/_next/` assets.

### RC-C: CDN caching `/_next/` assets incorrectly
If CDN is serving an old `/_next/static/` bundle but new HTML references it, layout breaks.

### RC-D: CSS file not loading (404/blocked)
Ad blockers, CSP, mixed content, or temporary network errors can block CSS/JS files.

### RC-E: Tailwind not applying because CSS import is missing in prod build
Less likely because local build passes and dev works, but still possible if prod has different build pipeline.

---

## 4) The “DB has 29/17 intents but dashboard shows none” (why it happens)

Old Queue used direct PostgREST query and strict filters, which can drop rows if:
- `status` is NULL (legacy rows)
- `lead_score` is NULL (legacy rows)
- RLS/policy differences between direct table reads and RPC

Fix that was made:
- Queue now fetches via **RPC `get_recent_intents_v1`** (same as LiveInbox)
- Then filters client-side with **status ∈ {NULL,'intent'} and lead_score ∈ {NULL,0}**

So if prod still shows “All Caught Up”, it is consistent with **not having the new commit** deployed.

---

## 5) What evidence to collect (Gemini checklist)

### A) Verify CSS is loading
Open DevTools → Network:
- Filter: “css”
- Check `/_next/static/css/...` is **200** (not 404)
- Check “blocked” (adblock/CSP)

### B) Verify JS chunks are loading
Network → filter: “chunk” or “_next/static”
- Any 404? Any “(from disk cache)” suspicious mismatch?

### C) Confirm which build is served
Network → Doc:
- Check response headers for deployment id / x-vercel-id (if Vercel)
- Compare to expected build time

### D) Hard refresh and bypass cache
- Chrome DevTools → Network → “Disable cache”
- Hard reload (Ctrl+Shift+R)
- Try Incognito window
- Application → Service Workers → “Unregister” (if present)
- Clear site data

### E) Confirm production actually includes the commit
If Vercel:
- Look at “Deployments” and confirm it built from the commit that contains the fixes (or from `master` HEAD).

---

## 6) Why “205 clicks Google Ads vs 185 sessions” can be normal

Click counts include events that do **not** guarantee a session:
- multiple clicks by same person
- bounces before tracking JS loads
- call extensions / deep links (never loads site)
- redirect stripping click IDs / params

Correct relationship is usually:
\[
\text{Clicks} \ge \text{Sessions} \ge \text{Intents}
\]

To prove the gap, run the SQL checks in:
- `docs/WAR_ROOM/REPORTS/TRACKING_GAP_INVESTIGATION.md`

---

## 7) Immediate action recommendation

1) Confirm prod deployed the latest commit  
2) If deployed, collect Network evidence (CSS/JS 404/blocked)  
3) Fix caching / CDN config accordingly  

---

## 8) Files involved in the fixes (for review)

- `components/icons.tsx` (brand SVGs now have hard width/height)
- `components/dashboard-v2/QualificationQueue.tsx` (Queue uses RPC `get_recent_intents_v1`)
- `docs/WAR_ROOM/REPORTS/TRACKING_GAP_INVESTIGATION.md` (metrics gap analysis)
- `docs/WAR_ROOM/REPORTS/DASHBOARD_FORENSICS_ANALYST_REPORT.md` (CSS/base sizing forensics)

