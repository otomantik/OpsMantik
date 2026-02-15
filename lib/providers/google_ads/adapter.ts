/**
 * Google Ads provider adapter. PR-G0: stub implementing IAdsProvider; real upload in PR-G3.
 */

import type { IAdsProvider, UploadConversionsArgs, UploadResult } from '../types';

const PROVIDER_KEY = 'google_ads';

export class GoogleAdsAdapter implements IAdsProvider {
  readonly providerKey = PROVIDER_KEY;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until PR-G3
  async verifyCredentials(_creds: unknown): Promise<void> {
    // Stub: no-op until PR-G3 (token refresh + minimal API call).
  }

  async uploadConversions(args: UploadConversionsArgs): Promise<UploadResult[]> {
    // Stub: return RETRY for all jobs until PR-G3 implements real upload.
    return args.jobs.map((job) => ({
      job_id: job.id,
      status: 'RETRY' as const,
      provider_ref: null,
      error_code: 'STUB',
      error_message: 'Google Ads adapter not implemented yet (PR-G3)',
    }));
  }
}

export const googleAdsAdapter = new GoogleAdsAdapter();
