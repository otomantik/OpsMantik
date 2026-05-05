# OCI Shadow Parity Canary (L18)

Purpose: compare producer decision path against worker decision path without changing live outcomes.

## Scope

- Canary only
- Time-boxed (for example 24h)
- Read-only parity metrics

## Checks

- producer click-source decision vs worker click-source decision
- enqueue decision mismatch count
- reconciliation reason mismatch count

## Exit Criteria

- mismatch rate below agreed threshold
- no increase in failed exports
- no duplicate visible intent cards
