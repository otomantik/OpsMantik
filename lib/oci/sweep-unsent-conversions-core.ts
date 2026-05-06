export type TerminalCallRow = {
  id: string | null;
  site_id: string | null;
  status?: string | null;
  oci_status?: string | null;
  confirmed_at?: string | null;
  sale_amount?: number | null;
  currency?: string | null;
  lead_score?: number | null;
};

export type SweepSkippedReason =
  | 'missing_site_id'
  | 'missing_call_id'
  | 'already_queued'
  | 'missing_click_id'
  | 'consent_missing'
  | 'not_export_eligible'
  | 'enqueue_failed'
  | 'unknown';

export function normalizeSweepSkippedReason(reason: string | null | undefined): SweepSkippedReason {
  switch ((reason ?? '').trim()) {
    case 'no_click_id':
      return 'missing_click_id';
    case 'marketing_consent_required':
      return 'consent_missing';
    case 'duplicate':
    case 'duplicate_session':
      return 'already_queued';
    case 'not_export_eligible':
      return 'not_export_eligible';
    case 'error':
      return 'enqueue_failed';
    default:
      return 'unknown';
  }
}

export function classifyDiscovery(call: Pick<TerminalCallRow, 'status' | 'oci_status'>): 'won' | 'sealed' | 'unknown' {
  if ((call.status ?? '').toLowerCase() === 'won') return 'won';
  if ((call.oci_status ?? '').toLowerCase() === 'sealed') return 'sealed';
  return 'unknown';
}

export function buildOrphanWorkset(
  calls: TerminalCallRow[],
  queuedCallIds: Set<string>
): {
  orphans: TerminalCallRow[];
  skipped: Record<SweepSkippedReason, number>;
  discoveredWon: number;
  discoveredSealed: number;
} {
  const skipped: Record<SweepSkippedReason, number> = {
    missing_site_id: 0,
    missing_call_id: 0,
    already_queued: 0,
    missing_click_id: 0,
    consent_missing: 0,
    not_export_eligible: 0,
    enqueue_failed: 0,
    unknown: 0,
  };
  const orphans: TerminalCallRow[] = [];
  let discoveredWon = 0;
  let discoveredSealed = 0;

  for (const call of calls) {
    const kind = classifyDiscovery(call);
    if (kind === 'won') discoveredWon++;
    else if (kind === 'sealed') discoveredSealed++;

    const callId = call.id ?? null;
    const siteId = call.site_id ?? null;
    if (!callId) {
      skipped.missing_call_id++;
      continue;
    }
    if (!siteId) {
      skipped.missing_site_id++;
      continue;
    }
    if (queuedCallIds.has(callId)) {
      skipped.already_queued++;
      continue;
    }
    orphans.push(call);
  }

  return { orphans, skipped, discoveredWon, discoveredSealed };
}
