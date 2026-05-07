/**
 * PR-1C — FAILED row taxonomy for queue health (observability only).
 * Lifecycle: FAILED remains FAILED; this module classifies *why* for metrics.
 * @see docs/architecture/OCI_QUEUE_HEALTH.md
 */

/** Must match DB CHECK / lib/domain/oci/queue-types.ts */
const KNOWN_PROVIDER_ERROR_CATEGORIES = new Set([
  'VALIDATION',
  'TRANSIENT',
  'RATE_LIMIT',
  'PERMANENT',
  'DETERMINISTIC_SKIP',
  'AUTH',
]);

// Fix typo if any row had PERMINENT in DB (defensive)
function normalizeCategory(raw: string | null | undefined): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  if (s === 'PERMINENT') return 'PERMANENT';
  return s;
}

export type QueueRowTaxonomyInput = {
  status?: string | null;
  provider_error_category?: string | null;
  provider_error_code?: string | null;
};

export type QueueFailureTaxonomyCounts = {
  total_failed_count: number;
  deterministic_skip_count: number;
  suppressed_higher_gear_count: number;
  provider_failed_count: number;
  policy_failed_count: number;
  unknown_failed_count: number;
  actionable_failed_count: number;
};

/**
 * Partition FAILED rows. Deterministic skips (expected non-upload outcomes) are excluded
 * from actionable/provider failure mass for rate gates.
 */
export function aggregateQueueFailureTaxonomy(rows: QueueRowTaxonomyInput[]): QueueFailureTaxonomyCounts {
  let total_failed_count = 0;
  let deterministic_skip_count = 0;
  let suppressed_higher_gear_count = 0;
  let provider_failed_count = 0;
  let policy_failed_count = 0;
  let unknown_failed_count = 0;

  for (const r of rows) {
    if (r.status !== 'FAILED') continue;
    total_failed_count += 1;
    const code = typeof r.provider_error_code === 'string' ? r.provider_error_code.trim() : '';
    if (code === 'SUPPRESSED_BY_HIGHER_GEAR') {
      suppressed_higher_gear_count += 1;
    }
    const cat = normalizeCategory(r.provider_error_category);
    if (cat === 'DETERMINISTIC_SKIP') {
      deterministic_skip_count += 1;
      continue;
    }
    if (!cat || !KNOWN_PROVIDER_ERROR_CATEGORIES.has(cat)) {
      unknown_failed_count += 1;
      continue;
    }
    if (cat === 'TRANSIENT' || cat === 'RATE_LIMIT' || cat === 'AUTH') {
      provider_failed_count += 1;
      continue;
    }
    if (cat === 'VALIDATION' || cat === 'PERMANENT') {
      policy_failed_count += 1;
      continue;
    }
    unknown_failed_count += 1;
  }

  const actionable_failed_count = total_failed_count - deterministic_skip_count;

  return {
    total_failed_count,
    deterministic_skip_count,
    suppressed_higher_gear_count,
    provider_failed_count,
    policy_failed_count,
    unknown_failed_count,
    actionable_failed_count,
  };
}

export function computeTaxonomyRates(input: {
  totalQueue: number;
  taxonomy: QueueFailureTaxonomyCounts;
  deadLetterQuarantineCount: number;
}): {
  total_failed_rate: number;
  actionable_failed_rate: number;
  provider_failed_rate: number;
  deterministic_skip_rate: number;
} {
  const t = input.totalQueue;
  if (t <= 0) {
    return {
      total_failed_rate: 0,
      actionable_failed_rate: 0,
      provider_failed_rate: 0,
      deterministic_skip_rate: 0,
    };
  }
  const dlq = input.deadLetterQuarantineCount;
  const failedTotal = input.taxonomy.total_failed_count;
  return {
    total_failed_rate: (failedTotal + dlq) / t,
    actionable_failed_rate: (input.taxonomy.actionable_failed_count + dlq) / t,
    provider_failed_rate: input.taxonomy.provider_failed_count / t,
    deterministic_skip_rate: input.taxonomy.deterministic_skip_count / t,
  };
}
