/**
 * Google Ads OAuth2: refresh token -> access token.
 * PR-G3: Used by adapter for verifyCredentials and uploadConversions.
 */

import type { GoogleAdsCredentials } from './types';
import { GOOGLE_ADS } from './types';
import { ProviderAuthError } from '../errors';

export async function getAccessToken(creds: GoogleAdsCredentials): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
  });

  const res = await fetch(GOOGLE_ADS.OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ProviderAuthError(
      `Google OAuth token refresh failed: ${res.status} ${text}`,
      'google_ads'
    );
  }

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new ProviderAuthError(
      data.error ? `Google OAuth: ${data.error}` : 'Google OAuth: no access_token in response',
      'google_ads'
    );
  }

  return data.access_token;
}
