export type SingleConversionGear = 'V2_PULSE' | 'V3_ENGAGE' | 'V4_INTENT' | 'V5_SEAL';

const SINGLE_CONVERSION_GEAR_RANK: Record<SingleConversionGear, number> = {
  V2_PULSE: 1,
  V3_ENGAGE: 2,
  V4_INTENT: 3,
  V5_SEAL: 4,
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
