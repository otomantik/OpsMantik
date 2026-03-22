# OCI runner refactor backlog

**File:** [`lib/oci/runner.ts`](../../lib/oci/runner.ts)

**Goal:** Reduce regression risk by splitting **claim → upload → persist** into testable modules without changing behavior.

**Suggested slices (incremental PRs):**

1. Pure helpers: error classification, retry delay (already partly in tests).
2. `claimJobs` / `releaseJobs` RPC wrappers in `runner-claims.ts`.
3. Upload adapter calls isolated in `runner-upload.ts`.

**Rule:** Each slice must pass `npm run test:oci-kernel` and not alter export row shapes.
