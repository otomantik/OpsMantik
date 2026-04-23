import { SignJWT, jwtVerify } from 'jose';

const PANEL_PREVIEW_COOKIE = 'om_panel_preview_ctx';
const PANEL_PREVIEW_ISSUER = 'opsmantik.panel-preview';
const PANEL_PREVIEW_AUDIENCE = 'panel-preview';
const PANEL_PREVIEW_TTL_SECONDS = 60 * 15;

export interface PanelPreviewContextPayload {
  userId: string;
  siteId: string;
  scope: 'ro';
}

export interface VerifiedPanelPreviewContext extends PanelPreviewContextPayload {
  exp: number;
}

function getSigningSecret(): string {
  const secret =
    process.env.PANEL_PREVIEW_CONTEXT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  if (!secret.trim()) {
    throw new Error('PANEL_PREVIEW_CONTEXT_SECRET_MISSING');
  }
  return secret.trim();
}

function getKey(): Uint8Array {
  return new TextEncoder().encode(getSigningSecret());
}

export function getPanelPreviewCookieName(): string {
  return PANEL_PREVIEW_COOKIE;
}

export function getPanelPreviewTtlSeconds(): number {
  return PANEL_PREVIEW_TTL_SECONDS;
}

export async function signPanelPreviewContext(payload: PanelPreviewContextPayload): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    siteId: payload.siteId,
    scope: payload.scope,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(PANEL_PREVIEW_ISSUER)
    .setAudience(PANEL_PREVIEW_AUDIENCE)
    .setExpirationTime(`${PANEL_PREVIEW_TTL_SECONDS}s`)
    .setIssuedAt()
    .sign(getKey());
}

export async function verifyPanelPreviewContext(token: string): Promise<VerifiedPanelPreviewContext | null> {
  if (!token || typeof token !== 'string') return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer: PANEL_PREVIEW_ISSUER,
      audience: PANEL_PREVIEW_AUDIENCE,
    });
    const userId = typeof payload.userId === 'string' ? payload.userId : '';
    const siteId = typeof payload.siteId === 'string' ? payload.siteId : '';
    const scope = payload.scope === 'ro' ? 'ro' : null;
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    if (!userId || !siteId || scope !== 'ro' || !exp) return null;
    return { userId, siteId, scope, exp };
  } catch {
    return null;
  }
}
