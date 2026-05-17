# Observability after Sentry webpack removal

## Current state

- `@sentry/nextjs` runtime SDK may still initialize from `instrumentation.ts`, `instrumentation-client.ts`, and `sentry.*.config.ts`.
- `next.config.ts` no longer wraps `withSentryConfig` (no Sentry webpack plugin / tunnel route / automatic Vercel cron monitors).

## Policy

- Production keeps `console.error` (see `removeConsole` in `next.config.ts`).
- Prefer structured logging via [`lib/logging`](../../lib/logging) where touched by refactors.

## Optional next steps

- Remove runtime `Sentry.init` entirely once alternative error sink exists (Logtail, Datadog, etc.) — track as separate ADR.
