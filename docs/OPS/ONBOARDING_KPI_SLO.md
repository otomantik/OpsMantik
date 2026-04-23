# Onboarding KPI/SLO Definition

## KPIs
- `site_creation_to_first_event_minutes` (P50/P95).
- `origin_verification_success_rate`.
- `first_try_install_success_rate`.
- `super_admin_task_completion_rate`.

## Log Events
- `SITES_CREATE_SUCCESS`
- `SITES_CREATE_UPDATED`
- `SITE_ORIGIN_VERIFIED`

## SLO Targets (initial)
- P95 site creation to first event: <= 30 minutes.
- Origin verification success: >= 98%.
- First-try install success: >= 90%.
- Super admin task completion: >= 95%.

## Alert Conditions
- 5-minute rolling create failure rate > 5%.
- Origin verification failure rate > 10% over 15 minutes.
- Realtime status `NO_TRAFFIC` spikes by > 3x baseline after rollout.

## Review Cadence
- Daily review first 7 days.
- Weekly review for first month.
