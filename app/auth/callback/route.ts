import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

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
  
  if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
    console.log('[AUTH_CALLBACK] Redirecting to:', redirectUrl);
  }

  // Redirect to dashboard after sign in process completes
  return NextResponse.redirect(redirectUrl);
}
