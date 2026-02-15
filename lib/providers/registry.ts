/**
 * Provider registry: resolve provider_key to adapter instance.
 * PR-G0: only google_ads supported; unknown keys throw.
 */

import type { IAdsProvider } from './types';
import { googleAdsAdapter } from './google_ads/adapter';

const SUPPORTED_KEYS = new Set<string>(['google_ads']);

/**
 * Returns the adapter for the given provider key.
 * @throws Error if provider_key is not supported (e.g. 'meta', 'tiktok' not yet implemented).
 */
export function getProvider(providerKey: string): IAdsProvider {
  if (!SUPPORTED_KEYS.has(providerKey)) {
    throw new Error(`Unsupported provider: ${providerKey}. Supported: ${[...SUPPORTED_KEYS].join(', ')}.`);
  }
  if (providerKey === 'google_ads') {
    return googleAdsAdapter;
  }
  throw new Error(`Unsupported provider: ${providerKey}. Supported: ${[...SUPPORTED_KEYS].join(', ')}.`);
}
