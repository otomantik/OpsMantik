/**
 * GO W2 — Sentry/GlitchTip client-side init.
 * Loaded via Next.js instrumentation; beforeSend scrubs PII (IP, fingerprint, phone).
 */
import * as Sentry from '@sentry/nextjs';
import { scrubEventPii } from '@/lib/security/sentry-pii';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const release = process.env.NEXT_PUBLIC_OPSMANTIK_RELEASE || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

Sentry.init({
  dsn: dsn || undefined,
  release: release || undefined,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubEventPii(event as import('@sentry/nextjs').Event) as typeof event | null;
  },
  // Minimal sampling for performance (optional)
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
