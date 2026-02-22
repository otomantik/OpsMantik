'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

const ALLOWED_LOCALES = ['en', 'tr', 'it'] as const;

export async function setUserLocale(locale: string): Promise<void> {
  const normalized = locale.toLowerCase().trim();
  if (!ALLOWED_LOCALES.includes(normalized as (typeof ALLOWED_LOCALES)[number])) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set('NEXT_LOCALE', normalized, {
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  revalidatePath('/', 'layout');
}
