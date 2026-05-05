import * as jose from 'jose';

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
  voidPublicKeyB64: string | undefined;
  requireSignatureEnv: string | undefined;
}): Promise<OciAckSignatureDecision> {
  const signature = (params.signatureHeader ?? '').trim();
  const publicKeyB64 = (params.voidPublicKeyB64 ?? '').trim();
  const signatureRequired = isTrueLike(params.requireSignatureEnv);

  if (signatureRequired && !publicKeyB64) {
    return {
      ok: false,
      status: 503,
      code: 'SIGNATURE_VERIFIER_UNAVAILABLE',
      reason: 'OCI_ACK_REQUIRE_SIGNATURE is enabled but VOID_PUBLIC_KEY is not configured',
      signature_required: true,
    };
  }

  if (signatureRequired && !signature) {
    return {
      ok: false,
      status: 401,
      code: 'AUTH_FAILED',
      reason: 'Cryptographic Signature Required',
      signature_required: true,
    };
  }

  if (!publicKeyB64 && !signature) {
    return {
      ok: true,
      status: 200,
      code: 'OK',
      reason: 'Signature not required',
      signature_required: signatureRequired,
    };
  }

  if (!publicKeyB64 && signature) {
    return {
      ok: false,
      status: 503,
      code: 'SIGNATURE_VERIFIER_UNAVAILABLE',
      reason: 'Signature provided but VOID_PUBLIC_KEY is not configured',
      signature_required: signatureRequired,
    };
  }

  if (publicKeyB64 && !signature) {
    return {
      ok: true,
      status: 200,
      code: 'OK',
      reason: 'Signature absent; API key path allowed',
      signature_required: signatureRequired,
    };
  }

  try {
    const publicKey = await jose.importSPKI(Buffer.from(publicKeyB64, 'base64').toString('utf8'), 'RS256');
    await jose.jwtVerify(signature, publicKey, {
      issuer: 'opsmantik-oci-script',
      audience: 'opsmantik-api',
    });
    return {
      ok: true,
      status: 200,
      code: 'OK',
      reason: 'Signature verified',
      signature_required: signatureRequired,
    };
  } catch {
    return {
      ok: false,
      status: 401,
      code: 'AUTH_FAILED',
      reason: 'Cryptographic Mismatch',
      signature_required: signatureRequired,
    };
  }
}
