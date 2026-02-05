/**
 * GO W2 — Next.js instrumentation: register Sentry server/edge and capture server errors.
 */
import * as Sentry from '@sentry/nextjs';
import { assertQstashEnv } from '@/lib/qstash/env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail-fast on server boot in production if QStash env is misconfigured.
    assertQstashEnv();
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
