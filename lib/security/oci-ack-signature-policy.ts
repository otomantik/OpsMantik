import { createHmac } from 'crypto';
import { timingSafeCompare } from './timing-safe-compare';

export type OciAckSignatureDecision = {
  ok: boolean;
  status: number;
  code: string;
  reason: string;
  signature_required: boolean;
};

function isTrueLike(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

export async function evaluateOciAckSignaturePolicy(params: {
  signatureHeader: string | null;
  payload: string;
  secret: string | undefined;
  requireSignatureEnv: string | undefined;
}): Promise<OciAckSignatureDecision> {
  const signature = (params.signatureHeader ?? '').trim();
  const secret = (params.secret ?? '').trim();
  const signatureRequired = isTrueLike(params.requireSignatureEnv);

  if (signatureRequired && !secret) {
    return {
      ok: false,
      status: 503,
      code: 'SIGNATURE_VERIFIER_UNAVAILABLE',
      reason: 'OCI_ACK_REQUIRE_SIGNATURE is enabled but Site API Secret is not configured',
      signature_required: true,
    };
  }

  if (signatureRequired && !signature) {
    return {
      ok: false,
      status: 401,
      code: 'AUTH_FAILED',
      reason: 'Cryptographic HMAC Signature Required',
      signature_required: true,
    };
  }

  if (!secret && !signature) {
    return {
      ok: true,
      status: 200,
      code: 'OK',
      reason: 'Signature not required',
      signature_required: signatureRequired,
    };
  }

  if (secret && signature) {
    const expectedSignature = createHmac('sha256', secret)
      .update(params.payload)
      .digest('hex');

    if (timingSafeCompare(expectedSignature, signature)) {
      return {
        ok: true,
        status: 200,
        code: 'OK',
        reason: 'HMAC verified',
        signature_required: signatureRequired,
      };
    } else {
      return {
        ok: false,
        status: 401,
        code: 'AUTH_FAILED',
        reason: 'Cryptographic Mismatch (HMAC)',
        signature_required: signatureRequired,
      };
    }
  }

  return {
    ok: true,
    status: 200,
    code: 'OK',
    reason: 'Signature absent; falling back to legacy auth',
    signature_required: signatureRequired,
  };
}
