/**
 * Shared vocabulary for OCI export coverage / eligible classification (plan SSOT).
 * Computed panels map raw rows into these buckets — do not conflate “no click id” with “missing export row”.
 */

/** Top-level coverage / operator-facing class. */
export const EXPORT_COVERAGE_CLASS = {
  NOT_EXPORT_ELIGIBLE: 'NOT_EXPORT_ELIGIBLE',
  EXPORT_EXPECTED_BUT_MISSING: 'EXPORT_EXPECTED_BUT_MISSING',
  PENDING_OR_PROCESSING: 'PENDING_OR_PROCESSING',
  FAILED: 'FAILED',
  SENT_OR_COMPLETED: 'SENT_OR_COMPLETED',
  /** Won row exists but export waits on precursor signals (not “missing row”). */
  ORDERING_VIOLATION_RISK: 'ORDERING_VIOLATION_RISK',
} as const;

export type ExportCoverageClassValue =
  (typeof EXPORT_COVERAGE_CLASS)[keyof typeof EXPORT_COVERAGE_CLASS];

/** Sub-reasons when class is NOT_EXPORT_ELIGIBLE. */
export const NOT_EXPORT_ELIGIBLE_REASON = {
  MISSING_CLICK_IDS: 'missing_click_ids',
  NO_ADS_ORIGIN: 'no_ads_origin',
  JUNK: 'junk',
  CONSENT_MISSING: 'consent_missing',
  UNSUPPORTED_PROVIDER: 'unsupported_provider',
  STAGE_NOT_EXPORTABLE: 'stage_not_exportable',
} as const;

export type NotExportEligibleReasonValue =
  (typeof NOT_EXPORT_ELIGIBLE_REASON)[keyof typeof NOT_EXPORT_ELIGIBLE_REASON];
