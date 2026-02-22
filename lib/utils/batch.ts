/**
 * Batch utilities for high-volume DB operations.
 * Reduces O(N) round-trips to O(N/chunkSize) with memory-safe chunking.
 */

/** Split array into chunks of size (max 1000 for Supabase safety). */
export function chunkArray<T>(arr: T[], size = 500): T[][] {
  const safeSize = Math.min(Math.max(1, size), 1000);
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += safeSize) {
    chunks.push(arr.slice(i, i + safeSize));
  }
  return chunks;
}

/**
 * Process items with max N concurrent in-flight promises.
 * Surfaces first rejection; does not swallow errors.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  maxConcurrent = 3
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(maxConcurrent, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results as R[];
}
