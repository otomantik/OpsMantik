import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { debugLog, debugWarn } from '@/lib/utils';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  
  // Compute redirect destination using NEXT_PUBLIC_PRIMARY_DOMAIN
  const primaryDomain = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;
  let redirectUrl: string;
  
  if (primaryDomain) {
    redirectUrl = `https://console.${primaryDomain}/dashboard`;
  } else {
    // Fallback to current origin (development only)
    redirectUrl = `${requestUrl.origin}/dashboard`;
    
    debugWarn('[AUTH_CALLBACK] NEXT_PUBLIC_PRIMARY_DOMAIN not set. Using fallback:', redirectUrl);
  }
  
  if (code) {
    // Create Supabase client with cookie handling for route handler
    const cookieStore = await cookies();
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !anonKey) {
      debugLog('[AUTH_CALLBACK] Missing Supabase env vars');
      return NextResponse.redirect(new URL('/login?error=config', redirectUrl));
    }
    
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
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            debugWarn('[AUTH_CALLBACK] Cookie set error (expected in route handler):', error);
          }
        },
      },
    });
    
    // Exchange code for session - this will set cookies via setAll
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    
    if (exchangeError) {
      debugLog('[AUTH_CALLBACK] Exchange error:', exchangeError);
      return NextResponse.redirect(new URL('/login?error=exchange', redirectUrl));
    }
    
    // Verify session was created
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      debugLog('[AUTH_CALLBACK] No session after exchange');
      return NextResponse.redirect(new URL('/login?error=no_session', redirectUrl));
    }
    
    // Get all cookies that were set during exchange
    const allCookies = cookieStore.getAll();
    
    debugLog('[AUTH_CALLBACK] Session exchanged. User:', session.user.email, 'Cookies:', allCookies.filter(c => c.name.startsWith('sb-')).length, 'Redirect:', redirectUrl);
    
    // Create redirect response - cookies are automatically included via cookieStore.set()
    // Next.js route handlers automatically include cookies set via cookies().set() in the response
    return NextResponse.redirect(redirectUrl);
  }
  
  debugWarn('[AUTH_CALLBACK] No code provided in callback');
  return NextResponse.redirect(new URL('/login?error=no_code', redirectUrl));
}
