import { cookies, headers } from 'next/headers';
import { resolveLocale } from './locale';

/**
 * Resolves the locale on the server side using Next.js headers and cookies.
 */
export async function getServerLocale() {
    const cookieStore = await cookies();
    const headerList = await headers();

    // Try cookie first (user preference), then Accept-Language header
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
    const acceptLanguage = headerList.get('accept-language');

    return resolveLocale(null, null, acceptLanguage, cookieLocale);
}
