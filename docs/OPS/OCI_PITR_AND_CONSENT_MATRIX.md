# OCI PITR and Consent Matrix (L20 + L21)

## PITR Header (Runbook Anchor)

If a bad OCI migration/backfill is applied:

1. Freeze non-critical OCI jobs.
2. Capture evidence snapshot (affected site ids, row counts, timestamps).
3. Execute approved PITR/rollback procedure with DBA signoff.
4. Re-run minimum release gates before resume.

## Consent Matrix (Legal Workshop Draft)

| Signal class | Consent required | Export allowed |
|---|---|---|
| direct ads click with marketing scope | yes | yes |
| direct ads click without marketing scope | yes | no |
| inferred stitched click | yes | guarded/no until legal approval |
| non-ads/no click id | n/a | no |

Notes:
- Technical possibility is not legal permission.
- Any ambiguous case defaults to no-export until policy confirmation.
