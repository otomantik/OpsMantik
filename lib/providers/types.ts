/**
 * Provider-agnostic types for offline conversion upload (OCI).
 * PR-G0: Registry & interfaces — used by Google Ads first, extensible to Meta/TikTok later.
 */

/** Click identifiers for attribution (e.g. GCLID, wbraid, gbraid). */
export interface ClickIds {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
}

/** A single conversion job to be sent to an ad provider. */
export interface ConversionJob {
  id: string;
  site_id: string;
  provider_key: string;
  payload: Record<string, unknown>;
  action_key?: string | null;
  action_id?: string | null;
  occurred_at: string; // ISO
  amount_cents: number;
  currency: string;
  click_ids: ClickIds;
}

/** Result for one job after upload attempt. */
export type UploadJobStatus = 'COMPLETED' | 'FAILED' | 'RETRY';

/** PR9: Error category for upload proof (provider_error_category). */
export type ProviderErrorCategory = 'VALIDATION' | 'AUTH' | 'TRANSIENT' | 'RATE_LIMIT';

export interface UploadResult {
  job_id: string;
  status: UploadJobStatus;
  provider_ref?: string | null;
  /** PR9: Provider request/correlation id if available (e.g. from response headers). */
  provider_request_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  /** PR9: Standardized category for FAILED/RETRY (VALIDATION, AUTH, TRANSIENT, RATE_LIMIT). */
  provider_error_category?: ProviderErrorCategory | null;
}

export interface UploadConversionsArgs {
  jobs: ConversionJob[];
  credentials: unknown;
}

/**
 * Ad provider contract. Implementations: google_ads (PR-G3), others scaffold later.
 */
export interface IAdsProvider {
  readonly providerKey: string;

  /** Verify credentials (e.g. token refresh + minimal API call). Throws typed provider errors. */
  verifyCredentials(creds: unknown): Promise<void>;

  /** Upload a batch of conversions. Returns one result per job. */
  uploadConversions(args: UploadConversionsArgs): Promise<UploadResult[]>;
}
