/**
 * PR-9H.6 — Design stub for future server-side Google Ads API offline conversion upload.
 * Not wired to live credentials or traffic. See intent-conversion-journal-contract for provider paths.
 */

export type GoogleAdsClickConversionPayload = {
  conversionAction: string;
  conversionDateTime: string;
  conversionValue?: number;
  currencyCode?: string;
  orderId?: string;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  hashedPhoneNumber?: string | null;
  hashedEmail?: string | null;
};

export type GoogleAdsUploadAttemptResult = {
  ok: boolean;
  providerRequestId?: string | null;
  partialFailures?: Array<{ index: number; message: string }>;
};

/**
 * Placeholder — implement with official Google Ads API client + customer id + conversion action resource names.
 */
export async function uploadClickConversionsStub(
  customerId: string,
  rows: GoogleAdsClickConversionPayload[]
): Promise<GoogleAdsUploadAttemptResult> {
  void customerId;
  void rows;
  return {
    ok: false,
    providerRequestId: null,
    partialFailures: [{ index: 0, message: 'GOOGLE_ADS_API_ADAPTER_NOT_ENABLED' }],
  };
}
