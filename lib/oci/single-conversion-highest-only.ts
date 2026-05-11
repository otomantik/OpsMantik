/**
 * SingleConversionGear — stages that produce a real OCI export event.
 * English-only post global-launch cutover.
 *
 * **Google Ads export (see `selectCoexistentFunnelExportCandidates`):** same call/session keeps
 * every queued row by default so Contacted / Offered / Junk / Won can all upload as separate
 * conversion actions. **Only** when contacted, offered, and won are **all** present in the same
 * group do we keep Won alone (full-funnel closure).
 *
 * **Legacy highest-only (see `selectHighestPriorityCandidates`):** `junk` ranks lowest so a single
 * winner per group can still be computed for tests / callers that need the old behavior.
 */
export type SingleConversionGear = 'junk' | 'contacted' | 'offered' | 'won';

const SINGLE_CONVERSION_GEAR_RANK: Record<SingleConversionGear, number> = {
  junk: 0,
  contacted: 1,
  offered: 2,
  won: 3,
};

export interface SingleConversionCandidate<T> {
  id: string;
  groupKey: string;
  gear: SingleConversionGear;
  sortKey?: string | null;
  value: T;
}

export function getSingleConversionGearRank(gear: SingleConversionGear): number {
  return SINGLE_CONVERSION_GEAR_RANK[gear];
}

export function pickHighestPriorityGear(
  gears: readonly SingleConversionGear[]
): SingleConversionGear | null {
  if (gears.length === 0) {
    return null;
  }

  return [...gears].sort((left, right) => {
    return getSingleConversionGearRank(right) - getSingleConversionGearRank(left);
  })[0] ?? null;
}

export function buildSingleConversionGroupKey(
  sessionId?: string | null,
  callId?: string | null,
  fallbackId?: string | null
): string {
  if (sessionId && sessionId.trim()) {
    return `session:${sessionId.trim()}`;
  }
  if (callId && callId.trim()) {
    return `call:${callId.trim()}`;
  }
  return `fallback:${(fallbackId || 'unknown').trim()}`;
}

export function selectHighestPriorityCandidates<T>(
  candidates: readonly SingleConversionCandidate<T>[]
): {
  kept: SingleConversionCandidate<T>[];
  suppressed: SingleConversionCandidate<T>[];
} {
  const kept: SingleConversionCandidate<T>[] = [];
  const suppressed: SingleConversionCandidate<T>[] = [];
  const grouped = new Map<string, SingleConversionCandidate<T>[]>();

  for (const candidate of candidates) {
    const list = grouped.get(candidate.groupKey) ?? [];
    list.push(candidate);
    grouped.set(candidate.groupKey, list);
  }

  for (const groupCandidates of grouped.values()) {
    const ranked = [...groupCandidates].sort((left, right) => {
      const rankDelta = getSingleConversionGearRank(right.gear) - getSingleConversionGearRank(left.gear);
      if (rankDelta !== 0) return rankDelta;

      const leftSort = left.sortKey ?? '';
      const rightSort = right.sortKey ?? '';
      const sortDelta = leftSort.localeCompare(rightSort);
      if (sortDelta !== 0) return sortDelta;

      return left.id.localeCompare(right.id);
    });

    const winner = ranked[0];
    if (!winner) continue;

    kept.push(winner);
    suppressed.push(...ranked.slice(1));
  }

  return { kept, suppressed };
}

/**
 * OCI → Google Ads export: same `groupKey` (session or call) may return **multiple** conversion
 * rows (different Ads “Conversion name” values). Suppress lower stages **only** when the group
 * contains at least one contacted, one offered, and one won — then a single Won row is kept
 * (earliest `sortKey`, then `id` tie-break). Otherwise every buildable candidate in the group is kept.
 */
export function selectCoexistentFunnelExportCandidates<T>(
  candidates: readonly SingleConversionCandidate<T>[]
): {
  kept: SingleConversionCandidate<T>[];
  suppressed: SingleConversionCandidate<T>[];
} {
  const kept: SingleConversionCandidate<T>[] = [];
  const suppressed: SingleConversionCandidate<T>[] = [];
  const grouped = new Map<string, SingleConversionCandidate<T>[]>();

  for (const candidate of candidates) {
    const list = grouped.get(candidate.groupKey) ?? [];
    list.push(candidate);
    grouped.set(candidate.groupKey, list);
  }

  for (const groupCandidates of grouped.values()) {
    const gears = new Set(groupCandidates.map((c) => c.gear));
    const fullFunnelTriple =
      gears.has('contacted') && gears.has('offered') && gears.has('won');

    if (!fullFunnelTriple) {
      kept.push(...groupCandidates);
      continue;
    }

    const wons = groupCandidates.filter((c) => c.gear === 'won');
    const rankedWons = [...wons].sort((left, right) => {
      const leftSort = left.sortKey ?? '';
      const rightSort = right.sortKey ?? '';
      const sortDelta = leftSort.localeCompare(rightSort);
      if (sortDelta !== 0) return sortDelta;
      return left.id.localeCompare(right.id);
    });
    const winner = rankedWons[0];
    if (!winner) {
      kept.push(...groupCandidates);
      continue;
    }

    kept.push(winner);
    for (const c of groupCandidates) {
      if (c.id !== winner.id) suppressed.push(c);
    }
  }

  return { kept, suppressed };
}
