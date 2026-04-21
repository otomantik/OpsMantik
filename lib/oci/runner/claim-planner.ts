import type { ConversionGroupRow } from '@/lib/oci/runner/db-types';

export type ClaimPlanInput = {
  limit: number;
  queuedCount: number;
  remaining: number;
};

export function buildClaimLimit(input: ClaimPlanInput): number {
  const base = Math.max(1, Math.min(input.limit, input.remaining));
  if (input.queuedCount <= 0) return 1;
  return Math.min(base, input.queuedCount);
}

export function computeFairShareClaimLimits(groups: ConversionGroupRow[], totalLimit: number): Map<string, number> {
  const claimLimits = new Map<string, number>();
  const totalQueued = groups.reduce((sum, g) => sum + Number(g.queued_count ?? 0), 0);
  if (totalQueued <= 0 || totalLimit <= 0) return claimLimits;

  let sum = 0;
  const raw = groups.map((g) => {
    const key = `${g.site_id}:${g.provider_key}`;
    const qc = Number(g.queued_count ?? 0);
    const lim = Math.max(1, Math.floor(totalLimit * (qc / totalQueued)));
    sum += lim;
    return { key, lim, qc, min_next_retry_at: g.min_next_retry_at ?? null, min_created_at: g.min_created_at ?? '' };
  });

  while (sum > totalLimit && raw.length > 0) {
    raw.sort((a, b) => {
      if (b.lim !== a.lim) return b.lim - a.lim;
      const an = a.min_next_retry_at ?? '';
      const bn = b.min_next_retry_at ?? '';
      if (an !== bn) return an.localeCompare(bn);
      return (a.min_created_at ?? '').localeCompare(b.min_created_at ?? '');
    });
    const row = raw[0];
    if (row.lim <= 1) break;
    row.lim--;
    sum--;
  }

  let leftover = totalLimit - sum;
  let idx = 0;
  while (leftover > 0 && raw.length > 0) {
    const row = raw[idx % raw.length];
    if (row.lim < row.qc) {
      row.lim++;
      leftover--;
    }
    idx++;
    if (idx > raw.length * 2) break;
  }

  for (const row of raw) claimLimits.set(row.key, row.lim);
  return claimLimits;
}
