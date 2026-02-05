/**
 * GO W2 — PII scrubbing for Sentry/GlitchTip.
 * Do NOT send: full IP, full fingerprint, full phone.
 * Applied in beforeSend / beforeSendTransaction in client, server, and edge configs.
 */
import type { Event } from '@sentry/nextjs';

const IP_PLACEHOLDER = '[IP]';
const FINGERPRINT_PLACEHOLDER = '[FINGERPRINT]';
const REDACTED = '[REDACTED]';
// Match E.164-like and common local formats (digits, optional + prefix)
const PHONE_REGEX = /\+?\d[\d\s\-.]{6,20}\d/g;

function maskPhone(value: string): string {
  return value.replace(PHONE_REGEX, (m) => {
    if (m.length <= 4) return '***';
    return m.slice(0, 2) + '***' + m.slice(-2);
  });
}

function deepScrubStrings(obj: unknown): void {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => deepScrubStrings(item));
    return;
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const v = (obj as Record<string, unknown>)[key];
      if (key.toLowerCase() === 'ip' || key === 'ip_address' || key === 'client_ip') {
        if (typeof v === 'string') (obj as Record<string, unknown>)[key] = IP_PLACEHOLDER;
      } else if (key.toLowerCase() === 'fingerprint') {
        if (typeof v === 'string') (obj as Record<string, unknown>)[key] = FINGERPRINT_PLACEHOLDER;
      } else if (key.toLowerCase().includes('phone') || key === 'tel') {
        if (typeof v === 'string') (obj as Record<string, unknown>)[key] = maskPhone(v);
      } else {
        deepScrubStrings(v);
      }
    }
  }
}

/** Scrub PII from a Sentry event (beforeSend). */
export function scrubEventPii(event: Event | null): Event | null {
  if (!event) return null;

  // User: no full IP
  if (event.user) {
    if (event.user.ip_address) event.user.ip_address = IP_PLACEHOLDER;
  }

  // Request headers / env often contain IP, fingerprint
  if (event.request) {
    if (event.request.headers && typeof event.request.headers === 'object') {
      const h = event.request.headers as Record<string, unknown>;

      // Normalize lookups, but preserve original keys if present.
      const keys = Object.keys(h);
      for (const k of keys) {
        const lk = k.toLowerCase();

        // Strip sensitive auth/session headers entirely.
        if (lk === 'cookie' || lk === 'set-cookie' || lk === 'authorization') {
          (h as Record<string, unknown>)[k] = REDACTED;
          continue;
        }

        // Mask IP headers
        if (lk === 'x-forwarded-for' || lk === 'x-real-ip' || lk === 'true-client-ip' || lk === 'cf-connecting-ip') {
          (h as Record<string, unknown>)[k] = IP_PLACEHOLDER;
          continue;
        }

        // Mask fingerprint-like headers (project-specific)
        if (lk === 'x-fingerprint') {
          (h as Record<string, unknown>)[k] = FINGERPRINT_PLACEHOLDER;
          continue;
        }
      }
    }
  }

  // Message and extra may contain phone numbers
  if (event.message && typeof event.message === 'string') {
    event.message = maskPhone(event.message);
  }
  if (event.extra && typeof event.extra === 'object') {
    deepScrubStrings(event.extra);
  }

  // Exception message
  if (event.exception?.values) {
    for (const exc of event.exception.values) {
      if (exc.value && typeof exc.value === 'string') exc.value = maskPhone(exc.value);
    }
  }

  return event;
}
