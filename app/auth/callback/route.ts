import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

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
    
    if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
      console.warn('[AUTH_CALLBACK] ⚠️ NEXT_PUBLIC_PRIMARY_DOMAIN not set. Using fallback:', redirectUrl);
    }
  }
  
  if (code) {
    // Create Supabase client with cookie handling for route handler
    const cookieStore = await cookies();
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !anonKey) {
      if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
        console.error('[AUTH_CALLBACK] Missing Supabase env vars');
      }
      return NextResponse.redirect(new URL('/login?error=config', redirectUrl));
    }
    
    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            // In route handlers, we need to handle cookies differently
            // The cookies will be set via the response headers
            if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
              console.warn('[AUTH_CALLBACK] Cookie set error (expected in route handler):', error);
            }
          }
        },
      },
    });
    
    // Exchange code for session - this will set cookies via setAll
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    
    if (exchangeError) {
      if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
        console.error('[AUTH_CALLBACK] Exchange error:', exchangeError);
      }
      return NextResponse.redirect(new URL('/login?error=exchange', redirectUrl));
    }
    
    // Verify session was created
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
        console.error('[AUTH_CALLBACK] No session after exchange');
      }
      return NextResponse.redirect(new URL('/login?error=no_session', redirectUrl));
    }
    
    // Get all cookies that were set during exchange
    const allCookies = cookieStore.getAll();
    
    if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
      console.log('[AUTH_CALLBACK] Session exchanged successfully. User:', session.user.email);
      console.log('[AUTH_CALLBACK] Cookies set:', allCookies.filter(c => c.name.startsWith('sb-')).length);
      console.log('[AUTH_CALLBACK] Redirecting to:', redirectUrl);
    }
    
    // Create redirect response - cookies are automatically included via cookieStore.set()
    // Next.js route handlers automatically include cookies set via cookies().set() in the response
    return NextResponse.redirect(redirectUrl);
  }
  
  // No code provided, redirect to login
  if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
    console.warn('[AUTH_CALLBACK] No code provided in callback');
  }
  return NextResponse.redirect(new URL('/login?error=no_code', redirectUrl));
}
