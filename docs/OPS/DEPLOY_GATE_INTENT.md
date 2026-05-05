# DEPLOY GATE — OCI Release Gates

`smoke:intent-multi-site` has been removed as a hard deploy blocker because multi-domain inventory is not guaranteed in every environment.

## Mandatory Gate

Run before each deploy:

```bash
npm run test:release-gates
```

This gate includes:
- `test:tenant-boundary`
- `test:oci-kernel`
- `test:runtime-budget`
- `test:chaos-core`
- `smoke:oci-rollout-readiness:strict`

## Optional Smoke

`smoke:intent-multi-site` remains available for operational diagnostics and targeted staging checks, but it is not required for deploy pass/fail.
