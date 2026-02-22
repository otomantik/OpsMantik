'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function setUserLocale(locale: 'en' | 'tr' | 'it'): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set('NEXT_LOCALE', locale, {
    maxAge: 31536000,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  revalidatePath('/', 'layout');
}
