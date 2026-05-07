import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { debugLog, debugWarn } from '@/lib/utils';

type OtpType = 'magiclink' | 'recovery' | 'invite' | 'email_change';

function parseOtpType(raw: string | null): OtpType {
  if (raw === 'recovery' || raw === 'invite' || raw === 'email_change') return raw;
  return 'magiclink';
}

function resolveConsoleBase(requestUrl: URL): string {
  const primaryDomain = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;
  if (primaryDomain) return `https://console.${primaryDomain}`;
  return requestUrl.origin;
}

function sanitizeNextPath(raw: string | null): string {
  if (!raw || !raw.trim()) return '/dashboard';
  if (!raw.startsWith('/')) return '/dashboard';
  if (raw.startsWith('//')) return '/dashboard';
  return raw;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const token = requestUrl.searchParams.get('token');
  const type = parseOtpType(requestUrl.searchParams.get('type'));
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get('next'));
  const consoleBase = resolveConsoleBase(requestUrl);

  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.redirect(new URL('/login?error=config', consoleBase));
  }

  const sessionCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookieOptions: {
      sameSite: 'lax',
      secure: true,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        sessionCookies.push(...cookiesToSet);
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch (error) {
          debugWarn('[AUTH_CONFIRM] Cookie set warning:', error);
        }
      },
    },
  });

  if (!tokenHash && !token) {
    return NextResponse.redirect(new URL('/login?error=no_token', consoleBase));
  }

  // Prefer hashed token flow; fallback to plain token for legacy links.
  const verification = tokenHash
    ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    : await supabase.auth.verifyOtp({ type, token: token ?? '' });

  if (verification.error) {
    debugLog('[AUTH_CONFIRM] verifyOtp error:', verification.error.message);
    return NextResponse.redirect(new URL('/login?error=otp_verify', consoleBase));
  }

  const destination = new URL(nextPath, consoleBase);
  const response = NextResponse.redirect(destination);
  sessionCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, {
      path: '/',
      sameSite: 'lax',
      secure: true,
      ...(options && typeof options === 'object' ? options : {}),
    });
  });
  return response;
}

