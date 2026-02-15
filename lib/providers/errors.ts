/**
 * Typed errors for ad providers (auth, rate limit, validation, transient).
 * PR-G0: Registry & interfaces.
 */

export class ProviderAuthError extends Error {
  readonly code = 'PROVIDER_AUTH_ERROR';
  constructor(message: string, public readonly providerKey?: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderRateLimitError extends Error {
  readonly code = 'PROVIDER_RATE_LIMIT';
  constructor(message: string, public readonly providerKey?: string, public readonly retryAfter?: number) {
    super(message);
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderValidationError extends Error {
  readonly code = 'PROVIDER_VALIDATION';
  constructor(message: string, public readonly providerKey?: string) {
    super(message);
    this.name = 'ProviderValidationError';
  }
}

export class ProviderTransientError extends Error {
  readonly code = 'PROVIDER_TRANSIENT';
  constructor(message: string, public readonly providerKey?: string) {
    super(message);
    this.name = 'ProviderTransientError';
  }
}
