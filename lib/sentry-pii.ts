/**
 * GO W2 — PII scrubbing for Sentry/GlitchTip.
 * Do NOT send: full IP, full fingerprint, full phone.
 * Applied in beforeSend / beforeSendTransaction in client, server, and edge configs.
 */
import type { Event } from '@sentry/nextjs';

const IP_PLACEHOLDER = '[IP]';
const FINGERPRINT_PLACEHOLDER = '[FINGERPRINT]';
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
      const h = event.request.headers as Record<string, string>;
      if (h['x-forwarded-for']) h['x-forwarded-for'] = IP_PLACEHOLDER;
      if (h['x-real-ip']) h['x-real-ip'] = IP_PLACEHOLDER;
      if (h['x-fingerprint']) h['x-fingerprint'] = FINGERPRINT_PLACEHOLDER;
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
