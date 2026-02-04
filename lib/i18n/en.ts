/**
 * UI strings (English). Replace with i18n later (e.g. tr.ts + t(key)).
 * No hardcoded user-facing text in components — use this file.
 */
export const strings = {
  // Dashboard shell
  operationsCenter: 'Operations Center',
  p0CommandCenter: 'P0 Command Center',
  reports: 'Reports',
  reportsSubtitle: 'Revenue, conversion pulse',
  liveQueue: 'Live Queue',
  liveQueueSubtitle: 'Intent qualification — today / yesterday',

  // Breakdown
  breakdown: 'Breakdown',
  breakdownSubtitle: 'Sessions — not Google Ads API clicks',
  sources: 'Sources',
  locations: 'Locations',
  devices: 'Devices',
  noLocationsInRange: 'No locations in range',
  noSourcesInRange: 'No sources in range',
  noDevicesInRange: 'No devices in range',
  otherLocations: (n: number) => `+${n} other locations`,
  dimensionSource: 'Source',
  dimensionDevice: 'Device',
  dimensionCity: 'City',
  noData: 'No data',

  // Date range
  quickSelect: 'Quick select',
  customDateRange: 'Custom date range',
  customDateRangeComingSoon: 'Date picker coming soon',
  selectedRange: 'Selected range',
  maxDays: (n: number) => `Max: ${n} days`,
  today: 'Today',
  yesterday: 'Yesterday',
  last7Days: 'Last 7 days',
  last30Days: 'Last 30 days',
  thisMonth: 'This month',

  // Intent status
  statusSealed: 'Sealed',
  statusJunk: 'Junk',
  statusSuspicious: 'Suspicious',
  statusPending: 'Pending',

  // Intent type
  typeCall: 'Call',
  typeConversion: 'Conversion',

  // Health / latency
  now: 'Now',
  minutesAgo: (n: number) => `${n} min ago`,
  hoursAgo: (n: number) => `${n} hr ago`,
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',

  // Timeline chart
  timeline: 'Timeline',
  traffic: 'Traffic',
  activity: 'Activity',
  calls: 'Calls',
  noDataInRange: 'No data in selected range',
  error: 'Error',
  retry: 'Retry',
  loading: 'Loading...',
  lastUpdate: 'Last update',
  updating: 'updating...',
  newDataAvailable: 'New data available',
  autoRefresh: (label: string) => `Auto refresh: ${label}`,
  autoRefresh5m: '5 minutes',
  autoRefresh30m: '30 minutes',

  // Queue empty state
  queueEmptyTitle: 'Mission Accomplished',
  queueEmptyYesterday: 'No data for yesterday',
  queueEmptyYesterdayDesc: 'No intents were found for yesterday in the selected time window.',
  queueEmptyTodayDesc: 'No pending intents to qualify. New intents from Google Ads will appear here automatically.',
  queueEmptyTryFullNetwork: 'Try Full Network Graph (menu) or Refresh to load intents from all sources.',
  queueEmptyUseRefresh: 'Use Refresh to fetch again.',
  refresh: 'Refresh',

  // Hunter card (simplified, user-friendly)
  hunterKeyword: 'Keyword',
  hunterLocation: 'Location',
  hunterPage: 'Page',
  hunterTime: 'Time',
  hunterDevice: 'Device',
  locationUnknown: 'Unknown',
  homepage: 'Homepage',
  aiConfidence: 'AI Confidence',

  // Seal modal (Lazy Antiques Dealer)
  sealModalTitle: 'Seal deal',
  sealModalStarLabel: 'Lead quality (required)',
  sealModalStarQualified: 'Qualified',
  sealModalPriceLabel: 'Actual price (optional)',
  sealModalPricePlaceholder: '0',
  sealModalJunk: 'Junk',
  sealModalCancel: 'Cancel',
  sealModalConfirm: 'Save',
  sealModalSealing: 'Saving…',
  sealModalDealSealed: 'Deal sealed.',
  sealModalMarkedJunk: 'Marked as junk.',

  // Generic
  errorLabel: (msg: string) => `Error: ${msg}`,
} as const;
