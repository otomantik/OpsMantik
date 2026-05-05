import { logWarn } from '@/lib/logging/logger';
import { SITE_PUBLIC_ID_RE, SITE_UUID_RE } from '@/lib/security/site-identifier';

type VerifySignatureResult = {
  data: boolean | null;
  error: { message?: string | null } | null;
};

export type CallEventSignaturePolicyResult =
  | { ok: true; headerSiteId: string; headerSig: string; bypassed: boolean }
  | { ok: false; status: 401 | 503; body: { error: string; code?: string } };

function isProdLikeEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.OCI_ENV === 'production'
  );
}

function isDevBypassEnabled(): boolean {
  const on =
    process.env.CALL_EVENT_SIGNATURE_DEV_BYPASS === '1' ||
    process.env.CALL_EVENT_SIGNATURE_DEV_BYPASS === 'true';
  return on && !isProdLikeEnvironment();
}

function isVerifierUnavailableError(err: { message?: string | null } | null): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    (msg.includes('verify_call_event_signature_v1') && msg.includes('does not exist')) ||
    msg.includes('undefined function')
  );
}

export async function verifyCallEventSignaturePolicy(params: {
  headers: Headers;
  rawBody: string;
  requestId?: string;
  route: string;
  verifySignature: (args: {
    sitePublicId: string;
    tsNum: number;
    rawBody: string;
    signature: string;
  }) => Promise<VerifySignatureResult>;
}): Promise<CallEventSignaturePolicyResult> {
  if (isDevBypassEnabled()) {
    logWarn('call-event signature bypass enabled (non-production only)', {
      request_id: params.requestId,
      route: params.route,
    });
    return { ok: true, headerSiteId: '', headerSig: '', bypassed: true };
  }

  const headerSiteId = (params.headers.get('x-ops-site-id') || '').trim();
  const headerTs = (params.headers.get('x-ops-ts') || '').trim();
  const headerSig = (params.headers.get('x-ops-signature') || '').trim();

  if (
    !headerSiteId ||
    !(SITE_PUBLIC_ID_RE.test(headerSiteId) || SITE_UUID_RE.test(headerSiteId)) ||
    !/^\d{9,12}$/.test(headerTs) ||
    !/^[0-9a-f]{64}$/i.test(headerSig)
  ) {
    return { ok: false, status: 401, body: { error: 'Unauthorized', code: 'SIGNATURE_REQUIRED' } };
  }

  const tsNum = Number(headerTs);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNum) || nowSec - tsNum > 300 || tsNum - nowSec > 60) {
    return { ok: false, status: 401, body: { error: 'Unauthorized', code: 'SIGNATURE_TIMESTAMP_INVALID' } };
  }

  const { data: sigOk, error: sigErr } = await params.verifySignature({
    sitePublicId: headerSiteId,
    tsNum,
    rawBody: params.rawBody,
    signature: headerSig,
  });

  if (isVerifierUnavailableError(sigErr)) {
    logWarn('call-event signature verifier unavailable (fail-closed)', {
      request_id: params.requestId,
      route: params.route,
      site_id: headerSiteId,
      error: sigErr?.message ?? null,
    });
    return {
      ok: false,
      status: 503,
      body: { error: 'Signature verifier unavailable', code: 'SIGNATURE_VERIFIER_UNAVAILABLE' },
    };
  }

  if (sigErr || sigOk !== true) {
    logWarn('call-event signature rejected', {
      request_id: params.requestId,
      route: params.route,
      site_id: headerSiteId,
      error: sigErr?.message ?? null,
    });
    return { ok: false, status: 401, body: { error: 'Unauthorized', code: 'SIGNATURE_INVALID' } };
  }

  return { ok: true, headerSiteId, headerSig, bypassed: false };
}
