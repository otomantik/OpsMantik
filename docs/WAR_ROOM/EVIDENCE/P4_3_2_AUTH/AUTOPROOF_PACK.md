# P4-3.2 Auth — storageState (no addCookies) — AUTOPROOF PACK

**Scope:** Fix Playwright auth: stop using addCookies (Invalid cookie fields); use storageState from a one-time login script.

---

## 1) Files touched

| File | Change |
|------|--------|
| `scripts/smoke/auth-login-save-state.mjs` | **NEW** — Programmatic login (Supabase signInWithPassword), inject session via document.cookie, save context.storageState; on failure save login-fail.png |
| `scripts/smoke/p4-ui-screenshot.mjs` | **MOD** — Remove addCookies/getSession; require PROOF_STORAGE_STATE file; newContext({ storageState }); assert not redirected to /login |
| `scripts/smoke/p4-3-screenshot.mjs` | **MOD** — Same: no cookies, use storageState; assert not /login |
| `package.json` | **MOD** — script `smoke:auth-save-state` |
| `.env.local.example` | **MOD** — PROOF_STORAGE_STATE, PROOF_EMAIL, PROOF_PASSWORD comments |
| `docs/WAR_ROOM/EVIDENCE/P4_3_2_AUTH/AUTOPROOF_PACK.md` | **NEW** — This file |

---

## 2) Proof commands (must pass)

Run in order (app must be running for step 1):

```bash
node scripts/smoke/auth-login-save-state.mjs
node scripts/smoke/p4-ui-screenshot.mjs
node scripts/smoke/p4-3-screenshot.mjs
```

Or:

```bash
npm run smoke:auth-save-state
node scripts/smoke/p4-ui-screenshot.mjs
node scripts/smoke/p4-3-screenshot.mjs
```

---

## 3) Command outputs (paste after run)

**auth-login-save-state.mjs:**

```
AUTH STATE SAVED: .../docs/WAR_ROOM/EVIDENCE/auth/auth-state.json
```

**p4-ui-screenshot.mjs:**

```
P4-2 UI screenshot saved: .../docs/WAR_ROOM/EVIDENCE/P4_2_UI/widgets.png
```

**p4-3-screenshot.mjs:**

```
Saved: .../P4_3_CHARTS/source-donut.png
Saved: .../P4_3_CHARTS/location-bars.png
P4-3 screenshot done. Files under ... : source-donut.png, location-bars.png
```

(Or fallback: source-card.png, location-card.png, full.png.)

---

## 4) Verify screenshots saved

| Path | Description |
|------|-------------|
| `docs/WAR_ROOM/EVIDENCE/P4_2_UI/widgets.png` | P4-2 breakdown widgets |
| `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/source-donut.png` or `source-card.png` | Source card |
| `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/location-bars.png` or `location-card.png` | Location card |

Auth state file: `docs/WAR_ROOM/EVIDENCE/auth/auth-state.json` (or PROOF_STORAGE_STATE).

---

## 5) PASS/FAIL checklist

| Item | Status |
|------|--------|
| auth-login-save-state.mjs creates auth-state.json | ☐ PASS / ☐ FAIL |
| p4-ui-screenshot.mjs runs without addCookies; produces widgets.png | ☐ PASS / ☐ FAIL |
| p4-3-screenshot.mjs runs without addCookies; produces source + location images | ☐ PASS / ☐ FAIL |
| Redirect to /login causes exit 1 and message to re-run auth script | ☐ PASS / ☐ FAIL |
| Missing PROOF_STORAGE_STATE file causes "NO STORAGE STATE; run ..." and exit 1 | ☐ PASS / ☐ FAIL |
