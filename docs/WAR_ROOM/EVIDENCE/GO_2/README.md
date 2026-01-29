# GO_2 Evidence

- **build_log.txt** — `npm run build` output.
- **playwright_log.txt** — Playwright run note (EPERM in env; local run instructions).
- **AUTOPROOF_PACK.md** — Full proof pack (files, diffs, build excerpt, Playwright flow).

To generate Playwright screenshots and run the test locally:

1. `npm run start` (or `npm run dev`).
2. `node scripts/smoke/go2-header-settings-proof.mjs`.
3. Check `mobile-header.png`, `mobile-menu-open.png` in this folder. Script also runs "open menu → Settings → assert dialog" twice.
