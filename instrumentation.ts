/**
 * GO W2 — Next.js instrumentation: register Sentry server/edge and capture server errors.
 */
import * as Sentry from '@sentry/nextjs';
import { assertQstashEnv } from '@/lib/qstash/env';
import { OPSMANTIK_VERSION } from '@/lib/version';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail-fast on server boot in production if QStash env is misconfigured.
    assertQstashEnv();
    const { startEventLoopMonitor } = await import('@/lib/observability/event-loop-monitor');
    startEventLoopMonitor();
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      release: OPSMANTIK_VERSION,
      tracesSampleRate: 1.0,
      debug: false,
      integrations: [],
    });
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
