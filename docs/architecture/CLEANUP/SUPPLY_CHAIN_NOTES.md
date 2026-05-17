# Supply chain notes

## Dependency weight

- Run `npm ls react next` occasionally to ensure a single major line.
- The npm package `googleapis` was removed from this app (Ads flows use `fetch` + typed helpers). Do not re-add `googleapis` without an ADR — it is heavy and duplicates surface area.

## Native binaries

- Prefer pure JS tooling in CI (`esbuild` already in devDependencies).

## Overrides

If `package.json` gains an `overrides` block, document **why** in this file with CVE or issue link.
