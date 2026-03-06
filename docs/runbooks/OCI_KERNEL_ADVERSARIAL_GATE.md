# OCI Kernel Adversarial Gate

## Purpose

This runbook defines the focused gate for OCI export, runner, recovery, and script-ack hardening.

The gate is intended to prove that the OCI kernel fails closed under deterministic skips, zero-value rows, credential gaps, retry exhaustion, recovery transitions, and script upload failure paths.

## Command

```bash
npm run test:oci-kernel
```

## Covered Surfaces

- Deep determinism regression for OCI sendability, recovery ownership, and script transition kernels
- Google Ads export preview contract, dual-cursor behavior, deterministic terminalization, and collision-resistant order IDs
- Provider worker loop backoff, max attempts, circuit states, semaphore gating, and recovery route auth
- Attempt-cap route auth and permanent terminalization
- Enqueue dedup determinism (`duplicate_session`, `23505`)
- Zero-value export guard and zero-value runner terminalization
- Script `ack-failed` behavior on upload exceptions and skipped IDs propagation

## Current Suites

- `tests/unit/deep-determinism-regression.test.ts`
- `tests/unit/oci-export-preview.test.ts`
- `tests/unit/providers-worker-loop.test.ts`
- `tests/unit/oci-attempt-cap.test.ts`
- `tests/unit/oci-dedup-determinism.test.ts`
- `tests/unit/oci-value-zero-export-guard.test.ts`
- `tests/unit/oci-value-zero-runner-guard.test.ts`
- `tests/unit/oci-script-ack-failed.test.ts`

## Expected Result

- All suites pass
- No skipped tests
- No direct app-side mutation path bypasses the DB-owned OCI transition kernels

## When To Run

- Before merging OCI export / runner / recovery changes
- After modifying queue claim, ack, outbox, or sweeper logic
- After changing script ACK semantics or Google Ads export behavior
- During OCI hardening sprints

## Notes

- This gate is DB-free and fast compared to the full integration suite
- This is a focused adversarial/kernel gate, not a live provider proof
- For tenant isolation proofs, use `npm run test:tenant-boundary`
