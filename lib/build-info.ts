/**
 * Build/deployment metadata for API response headers (deployment verification).
 * Vercel provides VERCEL_GIT_COMMIT_SHA and VERCEL_GIT_COMMIT_REF at runtime.
 */

export const HEADER_COMMIT = 'x-opsmantik-commit';
export const HEADER_BRANCH = 'x-opsmantik-branch';

/**
 * Returns headers with current build commit SHA and branch (or "unknown" when not on Vercel).
 * Pure function of process.env; safe to call from any route.
 */
export function getBuildInfoHeaders(): Record<string, string> {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'unknown';
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim() || 'unknown';
  return {
    [HEADER_COMMIT]: commit,
    [HEADER_BRANCH]: branch,
  };
}
