# Phase 0 — Full i18n Audit

## 1) Legacy imports (lib/i18n/en.ts / strings)

| File | Usage |
|------|-------|
| components/dashboard/health-indicator.tsx | strings.now, strings.minutesAgo, strings.hoursAgo, strings.healthy, strings.degraded, strings.critical |
| components/dashboard/timeline-chart.tsx | strings.noData, strings.noDataInRange, strings.traffic, strings.activity, strings.calls, strings.errorLabel, strings.retry, strings.loading, strings.lastUpdate, strings.updating, strings.newDataAvailable, strings.autoRefresh, strings.autoRefresh5m, strings.autoRefresh30m |
| components/dashboard/date-range-picker.tsx | strings.quickSelect, strings.customDateRange, strings.customDateRangeComingSoon, strings.selectedRange, strings.maxDays |
| lib/hooks/use-dashboard-date-range.ts | strings.today, strings.yesterday, strings.last7Days, strings.last30Days, strings.thisMonth |
| components/dashboard/hunter-card.tsx | strings.homepage, strings.locationUnknown, strings.aiConfidence, strings.hunterKeyword, strings.hunterLocation, strings.hunterPage, strings.hunterTime, strings.hunterDevice |
| components/dashboard/widgets/device-breakdown-card.tsx | strings.devices, strings.noDevicesInRange |
| components/dashboard/widgets/source-breakdown-card.tsx | strings.sources, strings.noSourcesInRange |
| components/dashboard/widgets/location-breakdown-card.tsx | strings.locations, strings.noLocationsInRange, strings.otherLocations(restCount) |
| components/dashboard/widgets/breakdown-widgets.tsx | strings.breakdown, strings.noDataInRange, strings.breakdownSubtitle |

## 2) Hardcoded UI text (by component)

| File | Hardcoded strings | Count |
|------|-------------------|-------|
| dashboard-shell.tsx | OCI ACTIVE, LATENCY, Activity Log, Yesterday Performance, Real-Time (Today), Timeline | 6+ |
| qualification-queue/queue-states.tsx | Intent Qualification Queue | 1 |
| activity-log-shell.tsx | Activity Log is not available..., Activity Log / Kill Feed | 2 |
| activity-log-inline.tsx | Activity Log | 1 |
| traffic-source-breakdown.tsx | Traffic Sources (4x), WHERE VISITORS CAME FROM | 5 |
| pulse-projection-widgets.tsx | Revenue Projection, Based on X sealed deals, Conversion Pulse, qualified / total incoming intents | 4+ |
| kpi-cards-v2.tsx | Critical failure, Retry Connection, No activity yet..., CAPTURE, SHIELD, etc. | 10+ |
| queue-states.tsx | Failed to load intents, Retry | 2 |
| use-queue-controller.ts | Undone., Deal cancelled. | 2 |

## 3) Text-generating functions outside t()

| Function | Location | Replacement |
|----------|----------|-------------|
| otherLocations(n) | lib/i18n/en.ts, location-breakdown-card | t('misc.otherLocations', { n }) |
| minutesAgo(n) | lib/i18n/en.ts, health-indicator | t('misc.minutesAgo', { n }) |
| hoursAgo(n) | lib/i18n/en.ts, health-indicator | t('misc.hoursAgo', { n }) |
| maxDays(n) | lib/i18n/en.ts, date-range-picker | t('misc.maxDays', { n }) |
| autoRefresh(label) | lib/i18n/en.ts, timeline-chart | t('misc.autoRefresh', { label }) |
| errorLabel(msg) | lib/i18n/en.ts, timeline-chart | t('misc.errorLabel', { msg }) |

## 4) Top 30 new keys required

1. statusBar.ociActive
2. statusBar.latency
3. statusBar.uptimeActive
4. kpi.capture
5. kpi.shield
6. kpi.efficiency
7. kpi.interest
8. kpi.verified
9. kpi.redacted
10. kpi.gclidRatio
11. kpi.avgScroll
12. traffic.title
13. traffic.whereVisitorsCameFrom
14. pulse.revenueProjection
15. pulse.basedOnDeals
16. pulse.conversionPulse
17. pulse.qualifiedTotal
18. activity.activityLog
19. activity.killFeed
20. activity.notAvailable
21. queue.intentQualificationQueue
22. queue.failedToLoad
23. health.now
24. health.minutesAgo
25. health.hoursAgo
26. health.healthy
27. health.degraded
28. health.critical
29. toast.undone
30. toast.dealCancelled

## 5) I18nProvider coverage

- app/dashboard/site/[siteId]/page.tsx — I18nProvider applied ✅
- app/dashboard/site/[siteId]/activity/page.tsx — NOT wrapped (ActivityLogShell needs provider)
- app/dashboard/page.tsx — site list, may need provider
