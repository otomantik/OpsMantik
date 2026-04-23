import { z } from 'zod';

const DOMAIN_REGEX = /^[a-z0-9.-]+(?::\d{1,5})?$/i;
const ISO_COUNTRY_REGEX = /^[A-Z]{2}$/;
const CURRENCY_REGEX = /^[A-Z]{3}$/;
const LOCALE_REGEX = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export const DEFAULT_SITE_LOCALE = 'tr-TR';
export const DEFAULT_SITE_COUNTRY = 'TR';
export const DEFAULT_SITE_TIMEZONE = 'Europe/Istanbul';
export const DEFAULT_SITE_CURRENCY = 'TRY';

export const SITE_LOCALE_OPTIONS = [
  { value: 'tr-TR', label: 'Turkish (Turkey)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'German (Germany)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
] as const;

export const SITE_COUNTRY_OPTIONS = [
  { value: 'TR', label: 'Turkey' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
] as const;

export const SITE_TIMEZONE_OPTIONS = [
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai' },
] as const;

export const SITE_CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY - Turkish Lira' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
] as const;

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
}

const createSiteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  domain: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .transform(normalizeDomain)
    .refine((value) => DOMAIN_REGEX.test(value), 'Invalid domain format'),
  locale: z
    .string()
    .trim()
    .default(DEFAULT_SITE_LOCALE)
    .transform((value) => value || DEFAULT_SITE_LOCALE)
    .refine((value) => LOCALE_REGEX.test(value), 'Invalid locale'),
  default_country_iso: z
    .string()
    .trim()
    .default(DEFAULT_SITE_COUNTRY)
    .transform((value) => value.toUpperCase() || DEFAULT_SITE_COUNTRY)
    .refine((value) => ISO_COUNTRY_REGEX.test(value), 'Invalid country ISO'),
  timezone: z
    .string()
    .trim()
    .default(DEFAULT_SITE_TIMEZONE)
    .transform((value) => value || DEFAULT_SITE_TIMEZONE),
  currency: z
    .string()
    .trim()
    .default(DEFAULT_SITE_CURRENCY)
    .transform((value) => value.toUpperCase() || DEFAULT_SITE_CURRENCY)
    .refine((value) => CURRENCY_REGEX.test(value), 'Invalid currency'),
});

export type CreateSiteInput = z.infer<typeof createSiteSchema>;

export function parseCreateSitePayload(raw: unknown): CreateSiteInput {
  const parsed = createSiteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid request payload');
  }
  return parsed.data;
}
