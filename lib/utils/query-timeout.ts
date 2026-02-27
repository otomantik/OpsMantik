/**
 * Sprint 3: Timeout wrapper for database-heavy reporting queries.
 * Prevents long-running transactions from locking up the pool.
 */

const DEFAULT_REPORTING_QUERY_MS = 10_000; // 10s

/**
 * Race a promise against a timeout. If the timeout wins, the promise is not cancelled
 * (it keeps running) but the caller gets a rejection so they can return 504 to the client.
 */
export function withQueryTimeout<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_REPORTING_QUERY_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`QUERY_TIMEOUT: exceeded ${ms}ms`));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
