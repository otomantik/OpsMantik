/**
 * Google Ads OAuth2: refresh token -> access token.
 * PR-G3: Used by adapter for verifyCredentials and uploadConversions.
 */

import type { GoogleAdsCredentials } from './types';
import { GOOGLE_ADS } from './types';
import { ProviderAuthError } from '../errors';

export async function getAccessToken(creds: GoogleAdsCredentials): Promise<string> {
  const clientId = creds.client_id?.trim() ?? '';
  const clientSecret = creds.client_secret?.trim() ?? '';
  const refreshToken = creds.refresh_token?.trim() ?? '';
  if (!refreshToken) {
    throw new ProviderAuthError('Google Ads: refresh_token is empty', 'google_ads');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(GOOGLE_ADS.OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    const hint =
      res.status === 400 && text.includes('invalid_grant')
        ? ' (Refresh token expired/revoked or wrong Client ID/Secret — regenerate using OAuth flow with the same client)'
        : '';
    throw new ProviderAuthError(
      `Google OAuth token refresh failed: ${res.status} ${text}${hint}`,
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
