/**
 * Sprint-1 Titanium Core: API hard gates.
 * Routes catch these errors and return 403 (capability) or 429 (quota) with correct headers.
 */

import type { Entitlements } from './types';
import type { CapabilityKey } from './types';

export class EntitlementError extends Error {
  readonly code = 'CAPABILITY_REQUIRED';
  readonly capability: CapabilityKey;
  constructor(capability: CapabilityKey) {
    super(`Capability required: ${capability}`);
    this.name = 'EntitlementError';
    this.capability = capability;
  }
}

export class QuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';
  constructor() {
    super('Quota exceeded');
    this.name = 'QuotaExceededError';
  }
}

/**
 * Throws EntitlementError if the capability is not granted. Routes should return 403.
 */
export function requireCapability(entitlements: Entitlements, key: CapabilityKey): void {
  if (!entitlements.capabilities[key]) {
    throw new EntitlementError(key);
  }
}

/**
 * Throws QuotaExceededError if currentUsage >= limitValue. Routes should return 429 with x-opsmantik-quota-exceeded: 1.
 * limitValue < 0 is treated as unlimited (no throw).
 */
export function requireWithinLimit(limitValue: number, currentUsage: number): void {
  if (limitValue < 0) return;
  if (currentUsage >= limitValue) {
    throw new QuotaExceededError();
  }
}
