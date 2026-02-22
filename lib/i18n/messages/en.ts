/** English messages — minimal key-value for pilot. */
export const en = {
  // Sidebar
  'sidebar.operationsCenter': 'Operations Center',
  'sidebar.reports': 'Reports',
  'sidebar.liveQueue': 'Live Queue',
  'sidebar.p0CommandCenter': 'P0 Command Center',
  'sidebar.reportsSubtitle': 'Revenue, conversion pulse',
  'sidebar.liveQueueSubtitle': 'Intent qualification — today / yesterday',

  // Dashboard
  'dashboard.title': 'Operations Center',
  'dashboard.calls': 'Calls',
  'dashboard.sessions': 'Sessions',
  'dashboard.sales': 'Sales',

  // Queue states
  'queue.sealed': 'Sealed',
  'queue.junk': 'Junk',
  'queue.suspicious': 'Suspicious',
  'queue.pending': 'Pending',

  // Empty states
  'empty.queueMissionAccomplished': 'Mission Accomplished',
  'empty.noDataYesterday': 'No data for yesterday',
  'empty.noDataYesterdayDesc': 'No intents were found for yesterday in the selected time window.',
  'empty.noDataTodayDesc': 'No pending intents to qualify. New intents from Google Ads will appear here automatically.',
  'empty.tryFullNetwork': 'Try Full Network Graph (menu) or Refresh to load intents from all sources.',
  'empty.useRefresh': 'Use Refresh to fetch again.',

  // Buttons
  'button.save': 'Save',
  'button.cancel': 'Cancel',
  'button.confirm': 'Confirm',
  'button.retry': 'Retry',
  'button.refresh': 'Refresh',

  // Intent types
  'intent.call': 'Call',
  'intent.conversion': 'Conversion',

  // Seal modal
  'seal.title': 'Seal deal',
  'seal.starLabel': 'Lead quality (required)',
  'seal.starQualified': 'Qualified',
  'seal.priceLabel': 'Actual Price (Optional)',
  'seal.priceHelper': 'You can skip the price. Adding it helps ROAS reporting.',
  'seal.pricePlaceholder': '0',
  'seal.junk': 'Junk',
  'seal.cancel': 'Cancel',
  'seal.confirm': 'Save',
  'seal.sealing': 'Saving…',
  'seal.dealSealed': 'Deal sealed.',
  'seal.markedJunk': 'Marked as junk.',

  // Dimension labels
  'dimension.source': 'Source',
  'dimension.device': 'Device',
  'dimension.city': 'City',

  // Misc
  'misc.loading': 'Loading...',
  'misc.error': 'Error',
  'misc.noData': 'No data',
  'misc.breakdown': 'Breakdown',
} as const;
