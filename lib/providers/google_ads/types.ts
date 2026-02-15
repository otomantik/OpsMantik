/**
 * Google Ads provider: credentials and API request/response shapes.
 * PR-G3: Real upload via REST (uploadClickConversions).
 */

/** Credentials stored in vault; used by auth + adapter. */
export interface GoogleAdsCredentials {
  customer_id: string;
  developer_token: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  login_customer_id?: string | null;
  conversion_action_resource_name?: string | null;
}

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const API_VERSION = 'v19';

export const GOOGLE_ADS = {
  OAUTH_TOKEN_URL,
  GOOGLE_ADS_API_BASE,
  API_VERSION,
  OAUTH_SCOPE: 'https://www.googleapis.com/auth/adwords',
} as const;

/** ClickConversion for uploadClickConversions (one of gclid, wbraid, gbraid required). */
export interface ClickConversionRequest {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  conversion_action: string;
  conversion_date_time: string;
  conversion_value?: number;
  currency_code?: string;
  order_id?: string | null;
}

export interface UploadClickConversionsRequest {
  conversions: ClickConversionRequest[];
  partial_failure?: boolean;
}

export interface UploadClickConversionsResponse {
  partial_failure_error?: {
    code?: number;
    message?: string;
    details?: Array<{ '@type'?: string; errors?: Array<{ error_code?: { [k: string]: unknown }; message?: string; location?: { field_path_elements?: Array<{ index?: number; field_name?: string }> } }> }>;
  };
  results?: Array<{
    gclid?: string | null;
    conversion_action?: string;
    conversion_date_time?: string;
    order_id?: string | null;
  }>;
}
