/** Queue-only retirement shim for legacy vacuum worker. */

export async function runVacuum(): Promise<{
  scanned: number;
  stalled: number;
  purged: number;
}> {
  return { scanned: 0, stalled: 0, purged: 0 };
}
