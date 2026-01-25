import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  const signIn = async () => {
    'use server';
    const supabase = await createClient();
    
    // Compute redirectTo using NEXT_PUBLIC_PRIMARY_DOMAIN
    const primaryDomain = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN;
    let redirectTo: string;
    
    if (primaryDomain) {
      redirectTo = `https://console.${primaryDomain}/auth/callback`;
    } else {
      // Fallback to current origin (development only)
      const fallbackOrigin = typeof window !== 'undefined' 
        ? window.location.origin 
        : 'http://localhost:3000';
      redirectTo = `${fallbackOrigin}/auth/callback`;
      
      if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
        console.warn('[AUTH] ⚠️ NEXT_PUBLIC_PRIMARY_DOMAIN not set. Using fallback:', redirectTo);
      }
    }
    
    if (process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true') {
      console.log('[AUTH] Google OAuth redirectTo:', redirectTo);
    }
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    });
    if (error) {
      console.error('Auth error:', error);
      return;
    }
    if (data.url) {
      redirect(data.url);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">OPSMANTIK</h1>
          <p className="mt-2 text-gray-600">Google Ads Attribution & Lead Intelligence</p>
        </div>
        <form action={signIn}>
          <Button type="submit" className="w-full" size="lg">
            Sign in with Google
          </Button>
        </form>
      </div>
    </div>
  );
}
