/**
 * Google Ads provider adapter. PR-G3: real upload via REST uploadClickConversions.
 */

import type { IAdsProvider, UploadConversionsArgs, UploadResult } from '../types';
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

async function uploadClickConversions(
  accessToken: string,
  customerId: string,
  developerToken: string,
  loginCustomerId: string | undefined,
  body: { conversions: unknown[]; partial_failure?: boolean }
): Promise<{ results?: unknown[]; partial_failure_error?: unknown }> {
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

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    const text = await res.text();
    throw new ProviderAuthError(
      `Google Ads API auth failed: ${res.status} ${text}`,
      PROVIDER_KEY
    );
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    throw new ProviderRateLimitError(
      'Google Ads API rate limit',
      PROVIDER_KEY,
      retryAfter ? parseInt(retryAfter, 10) : undefined
    );
  }
  if (res.status >= 400 && res.status < 500) {
    const text = await res.text();
    throw new ProviderValidationError(
      `Google Ads API client error: ${res.status} ${text}`,
      PROVIDER_KEY
    );
  }
  if (res.status >= 500) {
    const text = await res.text();
    throw new ProviderTransientError(
      `Google Ads API server error: ${res.status} ${text}`,
      PROVIDER_KEY
    );
  }

  return (await res.json()) as { results?: unknown[]; partial_failure_error?: unknown };
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
        });
      }
    }

    if (conversions.length === 0) {
      return jobs.map((j) => resultsByJobId.get(j.id) ?? { job_id: j.id, status: 'FAILED' as const, error_message: 'No conversions to upload' });
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

    const customerIdNoHyphens = credentials.customer_id.replace(/-/g, '');
    const loginCustomerId = credentials.login_customer_id?.trim() || undefined;

    const apiResponse = await uploadClickConversions(
      accessToken,
      credentials.customer_id,
      credentials.developer_token,
      loginCustomerId,
      { conversions, partial_failure: true }
    );

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
    if (partialFailure?.details) {
      for (const detail of partialFailure.details) {
        for (const err of detail.errors ?? []) {
          const index = err.location?.field_path_elements?.[0]?.index;
          if (typeof index === 'number' && index >= 0 && index < jobIdByIndex.length) {
            failedIndices.add(index);
            if (err.message) failureMessages[index] = err.message;
          }
        }
      }
    }

    for (let i = 0; i < jobIdByIndex.length; i++) {
      const jobId = jobIdByIndex[i];
      if (failedIndices.has(i)) {
        resultsByJobId.set(jobId, {
          job_id: jobId,
          status: 'RETRY',
          error_code: 'PARTIAL_FAILURE',
          error_message: failureMessages[i] ?? partialFailure?.details?.[0]?.errors?.[0]?.message ?? 'Upload failed',
        });
      } else {
        resultsByJobId.set(jobId, {
          job_id: jobId,
          status: 'COMPLETED',
          provider_ref: responseResults[i]?.order_id ?? null,
        });
      }
    }

    return jobs.map((j) => resultsByJobId.get(j.id) ?? { job_id: j.id, status: 'FAILED' as const, error_message: 'Unknown' });
  }
}

export const googleAdsAdapter = new GoogleAdsAdapter();
