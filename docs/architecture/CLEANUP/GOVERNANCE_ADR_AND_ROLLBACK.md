# Governance — ADR template and rollback

## When to write an ADR

Any PR that **removes** a route, cron, env var, or materially changes OCI ingest/export/ACK semantics.

## ADR template (copy to `docs/architecture/adr/NNNN-title.md`)

```markdown
# NNNN — Title

## Status
Proposed | Accepted | Superseded

## Context
What problem or cleanup forced this change?

## Decision
What did we choose?

## Consequences
Positive / negative. Performance, security, operator UX.

## Rollback
1. `git revert <sha>`
2. Restore Vercel env / cron entries (list keys).
3. Re-run `npm run test:release-gates`.
```

## Feature flags

Prefer toggling behavior with env-backed flags already used in repo (`OPSMANTIK_*`) before deleting code paths.

## Ownership

Use `CODEOWNERS` (optional) for `app/api/oci`, `lib/oci`, `supabase/migrations`.
