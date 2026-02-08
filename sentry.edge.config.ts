// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubEventPii } from "@/lib/security/sentry-pii";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const tracesSampleRate = (() => {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  return process.env.NODE_ENV === "production" ? 0.05 : 1.0;
})();

Sentry.init({
  dsn: dsn || undefined,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Match client-side privacy level: never send default PII.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  beforeSend(event) {
    return scrubEventPii(event as import("@sentry/nextjs").Event) as typeof event | null;
  },
});
