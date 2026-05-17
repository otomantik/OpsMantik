# SBOM and license policy

## OSV / registry audit (vulnerability scan)

**CI (informational):** `npm audit --omit=dev` (see `.github/workflows/ci.yml`). Install [Google OSV-Scanner](https://google.github.io/osv-scanner/) via your platform package manager if you want lockfile-level OSV locally; it is not wired as an npm dependency in this repo.

```bash
npm audit --omit=dev
```

Treat **critical** issues as release blockers after triage.

## Licenses

Run occasionally:

```bash
npx --yes license-checker-rseidelsohn@4 --production --excludePrivatePackages --summary
```

Flag `GPL`, `AGPL`, `SSPL` for legal review.

## Lockfile

- Always commit `package-lock.json`.
- CI uses `npm ci` only.
