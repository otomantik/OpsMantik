/**
 * Google Ads provider adapter. PR-G3: real upload via REST uploadClickConversions.
 * PR8A: Strict error classification — 400/validation => FAILED (no retry); 429/5xx/timeout => RETRY.
 * Batching: max 200 conversions per request (Google allows up to 2000; 200 keeps partial_failure
 * chunks small and avoids timeouts. Retries are controlled by the queue, not this layer.)
 */

import type { IAdsProvider, UploadConversionsArgs, UploadResult, ProviderErrorCategory } from '../types';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderValidationError,
  ProviderTransientError,
} from '../errors';
import type { GoogleAdsCredentials } from './types';
import { GOOGLE_ADS } from './types';
import { getAccessToken } from './auth';
import { mapJobsToClickConversions } from './mapper';

const PROVIDER_KEY = 'google_ads';

/** Max conversions per uploadClickConversions request. 200 is conservative for partial_failure and timeouts. */
const BATCH_SIZE = 200;

/** Request timeout (ms). We control retries via queue; no internal retry here. */
const REQUEST_TIMEOUT_MS = 30_000;

/** PR8A: Classification result for Google Ads API errors. */
export interface GoogleAdsErrorClassification {
  errorClass: 'ProviderAuthError' | 'ProviderRateLimitError' | 'ProviderValidationError' | 'ProviderTransientError';
  retryable: boolean;
  errorCode?: string;
  message: string;
}

/**
 * PR8A: Central error classification for Google Ads API responses.
 * - 429 => ProviderRateLimitError => RETRY
 * - 500-599 => ProviderTransientError => RETRY
 * - 400 => ProviderValidationError => FAILED (include provider error details)
 * - 401/403 => ProviderAuthError => FAILED (no retry)
 * - other 4xx => ProviderValidationError => FAILED unless explicitly retryable
 */
export function classifyGoogleAdsError(
  httpStatus: number,
  body: string,
  headers?: Headers
): GoogleAdsErrorClassification {
  const truncatedBody = body.slice(0, 500);
  let errorCode: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string; status?: string }; message?: string };
    const msg = parsed?.error?.message ?? parsed?.message ?? truncatedBody;
    if (parsed?.error?.status) errorCode = parsed.error.status;
    if (msg && msg !== truncatedBody) {
      const detail = typeof msg === 'string' ? msg : truncatedBody;
      return classifyByStatus(httpStatus, detail, errorCode, headers);
    }
  } catch {
    // non-JSON body
  }
  return classifyByStatus(httpStatus, truncatedBody || `HTTP ${httpStatus}`, errorCode, headers);
}

function classifyByStatus(
  httpStatus: number,
  message: string,
  errorCode?: string,
  headers?: Headers
): GoogleAdsErrorClassification {
  if (httpStatus === 429) {
    void headers?.get('retry-after');
    return {
      errorClass: 'ProviderRateLimitError',
      retryable: true,
      errorCode: errorCode ?? 'RATE_LIMIT',
      message: `Google Ads API rate limit: ${message}`,
    };
  }
  if (httpStatus >= 500 && httpStatus <= 599) {
    return {
      errorClass: 'ProviderTransientError',
      retryable: true,
      errorCode: errorCode ?? 'SERVER_ERROR',
      message: `Google Ads API server error ${httpStatus}: ${message}`,
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      errorClass: 'ProviderAuthError',
      retryable: false,
      errorCode: errorCode ?? 'AUTH_ERROR',
      message: `Google Ads API auth failed: ${httpStatus} ${message}`,
    };
  }
  if (httpStatus === 400) {
    return {
      errorClass: 'ProviderValidationError',
      retryable: false,
      errorCode: errorCode ?? 'INVALID_ARGUMENT',
      message: `Google Ads API validation error: ${message}`,
    };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return {
      errorClass: 'ProviderValidationError',
      retryable: false,
      errorCode: errorCode ?? `HTTP_${httpStatus}`,
      message: `Google Ads API client error ${httpStatus}: ${message}`,
    };
  }
  return {
    errorClass: 'ProviderTransientError',
    retryable: true,
    errorCode: errorCode ?? 'UNKNOWN',
    message: message || `HTTP ${httpStatus}`,
  };
}

function isGoogleAdsCredentials(c: unknown): c is GoogleAdsCredentials {
  const o = c as Record<string, unknown>;
  return (
    o != null &&
    typeof o === 'object' &&
    typeof o.customer_id === 'string' &&
    typeof o.developer_token === 'string' &&
    typeof o.client_id === 'string' &&
    typeof o.client_secret === 'string' &&
    typeof o.refresh_token === 'string'
  );
}

function assertCredentials(creds: unknown): asserts creds is GoogleAdsCredentials {
  if (!isGoogleAdsCredentials(creds)) {
    throw new ProviderValidationError(
      'Invalid Google Ads credentials: customer_id, developer_token, client_id, client_secret, refresh_token required',
      PROVIDER_KEY
    );
  }
  if (!creds.conversion_action_resource_name?.trim()) {
    throw new ProviderValidationError(
      'Google Ads credentials must include conversion_action_resource_name',
      PROVIDER_KEY
    );
  }
}

/**
 * PR8A: Strict partial_failure handling. RETRY only for transient/rate-limit;
 * All validation/date/GCLID errors => FAILED (permanent, do not requeue).
 *
 * Fatal (never retry): ConversionPrecedesClick, TooRecentConversion, INVALID_GCLID,
 * UNPARSEABLE_GCLID, INVALID_FIELD_VALUES_IN_DATE_TIME, DateError, RESOURCE_NOT_FOUND.
 */
function isRetryablePartialError(message: string): boolean {
  const m = message.toUpperCase();
  if (
    m.includes('CONVERSION_PRECEDES_CLICK') ||
    m.includes('TOO_RECENT_CONVERSION') ||
    m.includes('INVALID_GCLID') ||
    m.includes('UNPARSEABLE_GCLID') ||
    m.includes('INVALID_FIELD_VALUES') ||
    m.includes('DATE_ERROR') ||
    m.includes('DATEERROR') ||
    m.includes('RESOURCE_NOT_FOUND') ||
    m.includes('CONVERSION_NOT_FOUND') ||
    m.includes('INVALID_ARGUMENT')
  ) {
    return false;
  }
  return (
    m.includes('RESOURCE_EXHAUSTED') ||
    m.includes('UNAVAILABLE') ||
    m.includes('DEADLINE_EXCEEDED') ||
    m.includes('RATE_LIMIT') ||
    m.includes('RATE LIMIT') ||
    m.includes('TEMPORARILY') ||
    m.includes('BACKEND_ERROR')
  );
}

/** Extract Google Ads error code from message for provider_error_code (e.g. INVALID_GCLID, DateError.INVALID_FIELD_VALUES). */
function extractGoogleErrorCode(message: string): string {
  const m = message;
  const patterns = [
    /INVALID_GCLID/i,
    /UNPARSEABLE_GCLID/i,
    /CONVERSION_PRECEDES_CLICK/i,
    /TOO_RECENT_CONVERSION/i,
    /DateError\.INVALID_FIELD_VALUES/i,
    /INVALID_FIELD_VALUES_IN_DATE_TIME/i,
    /RESOURCE_NOT_FOUND/i,
    /CONVERSION_NOT_FOUND/i,
    /INVALID_ARGUMENT/i,
    /RESOURCE_EXHAUSTED/i,
    /UNAVAILABLE/i,
  ];
  for (const re of patterns) {
    const match = m.match(re);
    if (match) return match[0].toUpperCase().replace(/\./g, '_');
  }
  return 'PARTIAL_FAILURE';
}

/** Result of a single batch upload: success with payload, or PR8A batch failure (400/401/403/4xx => FAILED). PR9: request_id from response headers when success. */
type BatchUploadResult =
  | { success: true; results?: unknown[]; partial_failure_error?: unknown; request_id?: string | null }
  | { success: false; classification: GoogleAdsErrorClassification };

/** PR9: Map classifier errorClass to provider_error_category. */
function errorClassToCategory(errorClass: string): ProviderErrorCategory {
  switch (errorClass) {
    case 'ProviderAuthError':
      return 'AUTH';
    case 'ProviderRateLimitError':
      return 'RATE_LIMIT';
    case 'ProviderValidationError':
      return 'VALIDATION';
    default:
      return 'TRANSIENT';
  }
}

/**
 * Upload click conversions to Google Ads REST API.
 * PR8A: Non-retryable (400, 401, 403, 4xx) return batch failure; retryable (429, 5xx) throw. Timeout/network throw ProviderTransientError.
 * Auth: callers must obtain access_token via refresh_token at https://oauth2.googleapis.com/token.
 * Headers: Authorization (Bearer), developer-token, login-customer-id (critical for MCC).
 */
async function uploadClickConversions(
  accessToken: string,
  customerId: string,
  developerToken: string,
  loginCustomerId: string | undefined,
  body: { conversions: unknown[]; partial_failure?: boolean }
): Promise<BatchUploadResult> {
  const customerIdNoHyphens = customerId.replace(/-/g, '');
  const url = `${GOOGLE_ADS.GOOGLE_ADS_API_BASE}/${GOOGLE_ADS.API_VERSION}/customers/${customerIdNoHyphens}:uploadClickConversions`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isNetwork = /fetch|network|ECONNREFUSED|ETIMEDOUT/i.test(msg);
    if (isAbort || isNetwork) {
      throw new ProviderTransientError(
        `Google Ads API request failed (timeout/network): ${msg}`,
        PROVIDER_KEY
      );
    }
    throw new ProviderTransientError(
      err instanceof Error ? err.message : 'Google Ads API request failed',
      PROVIDER_KEY
    );
  }
  clearTimeout(timeoutId);

  const text = await res.text();
  if (!res.ok) {
    const classification = classifyGoogleAdsError(res.status, text, res.headers);
    if (classification.retryable) {
      if (classification.errorClass === 'ProviderRateLimitError') {
        const retryAfter = res.headers.get('retry-after');
        throw new ProviderRateLimitError(
          classification.message,
          PROVIDER_KEY,
          retryAfter ? parseInt(retryAfter, 10) : undefined
        );
      }
      throw new ProviderTransientError(classification.message, PROVIDER_KEY);
    }
    return { success: false, classification };
  }

  const data = JSON.parse(text || '{}') as { results?: unknown[]; partial_failure_error?: unknown };
  const requestId =
    res.headers.get('x-request-id') ||
    res.headers.get('x-goog-request-id') ||
    res.headers.get('request-id') ||
    null;
  return { success: true, results: data.results, partial_failure_error: data.partial_failure_error, request_id: requestId };
}

export class GoogleAdsAdapter implements IAdsProvider {
  readonly providerKey = PROVIDER_KEY;

  async verifyCredentials(creds: unknown): Promise<void> {
    assertCredentials(creds);
    await getAccessToken(creds);
  }

  async uploadConversions(args: UploadConversionsArgs): Promise<UploadResult[]> {
    const { jobs, credentials } = args;
    assertCredentials(credentials);

    const jobIdsSubmitted = new Set<string>();
    let conversions: unknown[] = [];
    let jobIdByIndex: string[] = [];

    try {
      const mapped = mapJobsToClickConversions(jobs, credentials);
      conversions = mapped.conversions;
      jobIdByIndex = mapped.jobIdByIndex;
      jobIdByIndex.forEach((id) => jobIdsSubmitted.add(id));
    } catch (err) {
      if (err instanceof ProviderValidationError) throw err;
      throw new ProviderValidationError(
        err instanceof Error ? err.message : 'Failed to map jobs to conversions',
        PROVIDER_KEY
      );
    }

    const resultsByJobId = new Map<string, UploadResult>();

    for (const job of jobs) {
      if (!jobIdsSubmitted.has(job.id)) {
        resultsByJobId.set(job.id, {
          job_id: job.id,
          status: 'FAILED',
          error_code: 'MISSING_CLICK_ID',
          error_message: 'No gclid, wbraid, or gbraid for this job',
          provider_error_category: 'VALIDATION',
        });
      }
    }

    if (conversions.length === 0) {
      return jobs.map((j) =>
        resultsByJobId.get(j.id) ?? {
          job_id: j.id,
          status: 'FAILED' as const,
          error_message: 'No conversions to upload',
          provider_error_category: 'VALIDATION',
        }
      );
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(credentials);
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      throw new ProviderAuthError(
        err instanceof Error ? err.message : 'Token refresh failed',
        PROVIDER_KEY
      );
    }

    const loginCustomerId = credentials.login_customer_id?.trim() || undefined;
    const conversionsArr = conversions as Record<string, unknown>[];

    for (let offset = 0; offset < conversionsArr.length; offset += BATCH_SIZE) {
      const batch = conversionsArr.slice(offset, offset + BATCH_SIZE);
      const batchJobIds = jobIdByIndex.slice(offset, offset + batch.length);

      const apiResponse = await uploadClickConversions(
        accessToken,
        credentials.customer_id,
        credentials.developer_token,
        loginCustomerId,
        { conversions: batch, partial_failure: true }
      );

      if (!apiResponse.success) {
        const category = errorClassToCategory(apiResponse.classification.errorClass);
        for (const jobId of batchJobIds) {
          resultsByJobId.set(jobId, {
            job_id: jobId,
            status: 'FAILED',
            error_code: apiResponse.classification.errorCode ?? 'BATCH_ERROR',
            error_message: apiResponse.classification.message,
            provider_error_category: category,
          });
        }
        break;
      }

      const batchRequestId = 'request_id' in apiResponse ? apiResponse.request_id ?? null : null;

      const responseResults = (apiResponse.results ?? []) as Array<{ order_id?: string | null }>;
      const partialFailure = apiResponse.partial_failure_error as {
        details?: Array<{
          errors?: Array<{
            message?: string;
            location?: { field_path_elements?: Array<{ index?: number }> };
          }>;
        }>;
      } | undefined;

      const failedIndices = new Set<number>();
      const failureMessages: Record<number, string> = {};
      const loggedCodes = new Set<string>();
      if (partialFailure?.details) {
        for (const detail of partialFailure.details) {
          for (const err of detail.errors ?? []) {
            const index = err.location?.field_path_elements?.[0]?.index;
            if (typeof index === 'number' && index >= 0 && index < batchJobIds.length) {
              failedIndices.add(index);
              if (err.message) failureMessages[index] = err.message;
              const msg = (err.message ?? '').toUpperCase();
              if (msg.includes('INVALID_GCLID') && !loggedCodes.has('INVALID_GCLID')) {
                console.warn('[google_ads] INVALID_GCLID:', err.message);
                loggedCodes.add('INVALID_GCLID');
              }
              if (msg.includes('RESOURCE_NOT_FOUND') && !loggedCodes.has('RESOURCE_NOT_FOUND')) {
                console.warn('[google_ads] RESOURCE_NOT_FOUND:', err.message);
                loggedCodes.add('RESOURCE_NOT_FOUND');
              }
            }
          }
        }
      }

      for (let i = 0; i < batchJobIds.length; i++) {
        const jobId = batchJobIds[i];
        if (failedIndices.has(i)) {
          const msg = failureMessages[i] ?? partialFailure?.details?.[0]?.errors?.[0]?.message ?? 'Upload failed';
          const status = isRetryablePartialError(msg) ? 'RETRY' : 'FAILED';
          const category: ProviderErrorCategory = status === 'RETRY' ? 'TRANSIENT' : 'VALIDATION';
          const errorCode = extractGoogleErrorCode(msg);
          resultsByJobId.set(jobId, {
            job_id: jobId,
            status,
            error_code: errorCode,
            error_message: msg,
            provider_error_category: category,
          });
        } else {
          resultsByJobId.set(jobId, {
            job_id: jobId,
            status: 'COMPLETED',
            provider_ref: responseResults[i]?.order_id ?? null,
            provider_request_id: batchRequestId,
          });
        }
      }
    }

    return jobs.map((j) => resultsByJobId.get(j.id) ?? { job_id: j.id, status: 'FAILED' as const, error_message: 'Unknown' });
  }
}

export const googleAdsAdapter = new GoogleAdsAdapter();
