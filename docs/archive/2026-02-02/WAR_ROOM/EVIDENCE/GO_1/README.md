# GO_1 Evidence

- **build_log.txt** — `npm run build` output.
- **smoke_log.txt** — `npm run smoke:api` output.
- **AUTOPROOF_PACK.md** — Full proof pack (files, diffs, build/smoke excerpts, Playwright instructions).

To generate Playwright screenshots (desktop + mobile) locally:

1. `npm run start` (or `npm run dev`).
2. `node scripts/smoke/go1-screenshots.mjs`.
3. Check `desktop.png` and `mobile.png` in this folder.
