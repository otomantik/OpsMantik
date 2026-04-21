export function sortDeterministicIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
}

export function stableScheduleKey(updatedAtIso: string, id: string): string {
  return `${updatedAtIso}::${id}`;
}

export function isNoWorkProof(claimedCount: number, scannedCount: number): boolean {
  return claimedCount === 0 && scannedCount >= 0;
}
