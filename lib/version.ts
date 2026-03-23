/**
 * OpsMantik Version Authority
 * Single source of truth for system-wide versioning and feature flags.
 * 
 * Centralizing this ensures that Edge Workers, Background Jobs, and DB Metadata
 * are always in sync, enabling accurate forensic tracing and rollout control.
 */

export const OPSMANTIK_VERSION = '2.2.0-elite';
export const IDEMPOTENCY_VERSION = '2';

export const TRACKER_VERSION = '2.1.0';

export const COMPAT_MAP = {
  MIN_TRACKER_VERSION: '1.8.0',
};
