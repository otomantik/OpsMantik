/**
 * Google Ads provider: credentials and API request/response shapes.
 * PR-G3: Real upload via REST (uploadClickConversions).
 */

/**
 * Credentials for Google Ads API (vault or env). Used by auth + adapter.
 *
 * **MCC (Manager) structure:**
 * - `login_customer_id`: The MCC (Manager) account ID — required when managing a client account.
 *   Sent as the `login-customer-id` header. Example: `854-075-5158`.
 * - `customer_id`: The target client account ID where conversions are uploaded.
 *   Example: `525-429-9323`.
 */
export interface GoogleAdsCredentials {
  /** Target Google Ads customer ID (client account; e.g. 525-429-9323). */
  customer_id: string;
  /** Google Ads API developer token (Test or Basic access). */
  developer_token: string;
  /** OAuth2 client ID (Google Cloud Console). */
  client_id: string;
  /** OAuth2 client secret. */
  client_secret: string;
  /** OAuth2 refresh token (from one-time OAuth flow; used to obtain access tokens). */
  refresh_token: string;
  /** MCC account ID (e.g. 854-075-5158). Sent as `login-customer-id` header; critical for MCC. */
  login_customer_id?: string | null;
  /** Resource name for the conversion action (e.g. customers/5254299323/conversionActions/123456789). */
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
