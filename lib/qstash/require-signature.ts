/**
 * QStash signature guard for /api/sync/worker (and any route that must accept only signed QStash requests).
 *
 * ENV VARS (required for production):
 * - QSTASH_CURRENT_SIGNING_KEY: Current signing key (required in prod). Used to verify request signatures.
 * - QSTASH_NEXT_SIGNING_KEY: Next signing key for rotation. Optional; if missing, current is used for both
 *   so verification still runs. Set both during key rotation to avoid 403s.
 *
 * LOCAL DEV BYPASS (insecure; use only on localhost):
 * - NODE_ENV must NOT be "production"
 * - ALLOW_INSECURE_DEV_WORKER=true must be set explicitly
 * When both hold, the handler runs without signature verification. Otherwise we always verify or 503.
 *
 * BEHAVIOUR:
 * - Production: Always verify. If QSTASH_CURRENT_SIGNING_KEY is missing -> 503 (fail-closed).
 * - Non-production without ALLOW_INSECURE_DEV_WORKER=true: Same as production (verify or 503).
 * - Non-production with ALLOW_INSECURE_DEV_WORKER=true: Bypass verification (handler only).
 *
 * There is no code path in production where the worker runs without signature verification.
 */

import type { NextRequest } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { logWarn } from '@/lib/logging/logger';

type AppRouterHandler = (request: NextRequest, params?: unknown) => Response | Promise<Response>;

const JSON_403_HEADERS = { 'Content-Type': 'application/json' } as const;

function forbiddenResponse(code: string, message?: string): Response {
  const body: { error: string; code: string; message?: string } = { error: 'forbidden', code };
  if (message) body.message = message;
  return new Response(JSON.stringify(body), { status: 403, headers: JSON_403_HEADERS });
}

function isProduction(): boolean {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.IS_BUILDING === 'true') {
    return false;
  }
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function allowInsecureDevBypass(): boolean {
  return !isProduction() && process.env.ALLOW_INSECURE_DEV_WORKER === 'true';
}

function getSigningKeys(): { current: string; next: string } | null {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const next = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!current) return null;
  return { current, next: next || current };
}

/**
 * Wraps the handler so that in production (or when not allowing insecure dev bypass),
 * QStash signature is always verified. If signing keys are missing -> 503. Invalid signature -> 403 from SDK.
 */
export function requireQstashSignature(handler: AppRouterHandler): AppRouterHandler {
  if (allowInsecureDevBypass()) {
    return handler;
  }

  const keys = getSigningKeys();
  if (!keys) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- handler signature requires request param
    return async (_req: NextRequest) => {
      return new Response(
        JSON.stringify({ error: 'QStash signing keys misconfigured', code: 'QSTASH_KEYS_MISSING' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    };
  }

  const inner = verifySignatureAppRouter(handler, {
    currentSigningKey: keys.current,
    nextSigningKey: keys.next,
  });

  return (async (request: NextRequest, params?: unknown): Promise<Response> => {
    try {
      const res = await inner(request, params);
      if (res.status === 403) {
        const text = await res.text();
        const isMissing = /missing/i.test(text);
        const code = isMissing ? 'QSTASH_SIGNATURE_MISSING' : 'QSTASH_SIGNATURE_INVALID';
        const message = isMissing ? 'Upstash-Signature header is missing' : 'Invalid or malformed QStash signature';
        logWarn('qstash signature rejected', {
          code,
          requestId: request.headers.get('x-request-id') ?? undefined,
        });
        return forbiddenResponse(code, message);
      }
      return res;
    } catch {
      logWarn('qstash signature rejected', {
        code: 'QSTASH_SIGNATURE_INVALID',
        requestId: request.headers.get('x-request-id') ?? undefined,
      });
      return forbiddenResponse('QSTASH_SIGNATURE_INVALID', 'Invalid or malformed QStash signature');
    }
  }) as AppRouterHandler;
}
