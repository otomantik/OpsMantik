# GitHub Release Gates Required Check

## Purpose

This runbook defines the GitHub-side enforcement for release gate execution.
The goal is to prevent merges or releases that skip `tenant-boundary`, `oci-kernel`, or the target-site intent smoke.

## Required Workflow

The required GitHub Actions workflow is:

- `.github/workflows/release-gates.yml`

The workflow must run on:

- Pull requests targeting `master` / `main`
- Pushes to `master` / `main`
- Manual dispatch when operators need an out-of-band rerun

The workflow must produce:

- A green `Release Gates` check
- An uploaded `release-gate-evidence-pr` artifact on pull requests
- An uploaded `release-gate-evidence` artifact on push/manual release proof runs

## Branch Protection Setup

Apply this to both `master` and `main` if both branches are used:

1. Open GitHub repository settings.
2. Go to `Branches`.
3. Edit the branch protection rule for the target branch.
4. Enable `Require a pull request before merging`.
5. Enable `Require status checks to pass before merging`.
6. Add `Release Gates` to the required status checks list.
7. Keep `Require branches to be up to date before merging` enabled if your release process already expects rebasing or merge updates.

Important:

- A required status check is only meaningful if it runs on pull requests.
- `Release Gates` is configured to run on PRs, so it can be used as a true merge barrier.

## PR Operator Expectations

Before merge:

- Run `npm run test:release-gates:pr` locally for the PR-safe gate.
- Run `npm run release:evidence:pr` when you need PR-safe evidence locally.
- Run `npm run test:release-gates` and `npm run release:evidence` when preparing the live release record.
- Confirm the generated markdown artifacts are present at `tmp/release-gates-pr.md` and `tmp/release-gates-latest.md` when applicable.
- Confirm GitHub uploaded `release-gate-evidence-pr` on the PR and `release-gate-evidence` on release proof runs.
- Confirm the PR itself shows a green `Release Gates` check before merge.

## Failure Policy

Do not merge when any of the following is true:

- `Release Gates` workflow is red
- `release-gate-evidence-pr` artifact is missing on the PR
- `tenant-boundary` gate was skipped
- `oci-kernel` gate was skipped
- Live release proof was required but target-site intent smoke did not pass `1/1`

## Manual Fallback

If GitHub Actions is temporarily unavailable:

1. Run `npm run release:evidence` locally.
2. Review `tmp/release-gates-latest.md`.
3. Attach the artifact content to the release record.
4. Restore GitHub enforcement before the next deploy window.
