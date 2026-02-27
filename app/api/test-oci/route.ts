/**
 * GET /api/test-oci — Test Google Ads Offline Conversion Import (OCI).
 * Reads credentials from process.env; sends a MOCK conversion payload to verify API connection.
 * In Test Mode, Google typically returns INVALID_GCLID or RESOURCE_NOT_FOUND — that confirms connection.
 * Next.js 16 App Router.
 */

import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/providers/google_ads/auth';
import { GOOGLE_ADS } from '@/lib/providers/google_ads/types';
import type { GoogleAdsCredentials } from '@/lib/providers/google_ads/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getTestCredentials(): GoogleAdsCredentials {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID ?? '525-429-9323';
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '854-075-5158';
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? 'hlw_ulOQ8RpqwulGcm_Snw';
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing env: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN'
    );
  }

  return {
    customer_id: customerId,
    developer_token: developerToken,
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    login_customer_id: loginCustomerId,
    conversion_action_resource_name:
      process.env.GOOGLE_ADS_CONVERSION_ACTION_RESOURCE_NAME ??
      'customers/5254299323/conversionActions/123456789',
  };
}

/** Format: yyyy-mm-dd hh:mm:ss+|-hh:mm (no milliseconds; timezone required). */
function toConversionDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
}

/** Dev/sandbox only; not available in production. */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const creds = getTestCredentials();
    const accessToken = await getAccessToken(creds);

    const conversionDateTime = toConversionDateTime(new Date());
    const mockPayload = {
      conversions: [
        {
          gclid: 'TeSt_GCLID_For_Connection_Check',
          conversion_action: 'customers/5254299323/conversionActions/123456789',
          conversion_date_time: conversionDateTime,
          conversion_value: 100.0,
        },
      ],
      partial_failure: true,
    };

    const customerIdNoHyphens = creds.customer_id.replace(/-/g, '');
    const url = `${GOOGLE_ADS.GOOGLE_ADS_API_BASE}/${GOOGLE_ADS.API_VERSION}/customers/${customerIdNoHyphens}:uploadClickConversions`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': creds.developer_token,
      'Content-Type': 'application/json',
    };
    if (creds.login_customer_id?.trim()) {
      headers['login-customer-id'] = creds.login_customer_id.replace(/-/g, '');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(mockPayload),
    });

    const responseText = await res.text();
    let googleResponse: unknown = {};
    try {
      googleResponse = responseText ? JSON.parse(responseText) : {};
    } catch {
      googleResponse = { _raw_body: responseText };
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      url_called: url,
      google_response: googleResponse,
      message: !res.ok
        ? 'Expected: Google may return INVALID_GCLID or RESOURCE_NOT_FOUND (confirms connection in Test Mode).'
        : 'Unexpected success with mock GCLID.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, google_response: null },
      { status: 500 }
    );
  }
}
